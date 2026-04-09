/**
 * integrations/jenkins.groovy — Jenkins Pipeline for Grafana Sentinel
 * Supports: smoke, standard, full test levels; pre/post upgrade snapshot; multi-instance compare
 */

pipeline {
    agent any

    parameters {
        choice(name: 'TEST_LEVEL',
               choices: ['smoke', 'standard', 'full'],
               description: 'Sentinel test level')
        string(name: 'GRAFANA_URL',
               defaultValue: '',
               description: 'Grafana URL (overrides credential)')
        booleanParam(name: 'CAPTURE_SNAPSHOT',
                     defaultValue: false,
                     description: 'Capture pre-upgrade snapshot before tests')
        booleanParam(name: 'PUSH_METRICS',
                     defaultValue: true,
                     description: 'Push metrics to Pushgateway after tests')
        string(name: 'SNAPSHOT_LABEL',
               defaultValue: '',
               description: 'Snapshot label (blank = auto-timestamp)')
    }

    environment {
        SENTINEL_DIR     = "${WORKSPACE}"
        REPORTS_DIR      = "${WORKSPACE}/reports"
        SNAPSHOTS_DIR    = "${WORKSPACE}/snapshots"
        NODE_VERSION     = '20'
    }

    options {
        timeout(time: 2, unit: 'HOURS')
        buildDiscarder(logRotator(numToKeepStr: '30'))
        disableConcurrentBuilds()
    }

    triggers {
        // Daily full run at 07:00
        cron(env.BRANCH_NAME == 'main' ? 'H 7 * * *' : '')
    }

    stages {
        stage('Setup') {
            steps {
                script {
                    def nodeVersion = sh(script: 'node --version', returnStdout: true).trim()
                    echo "Node.js: ${nodeVersion}"
                }
                sh 'cd backend && npm ci --prefer-offline'
                sh 'mkdir -p ${REPORTS_DIR} ${SNAPSHOTS_DIR}'
            }
        }

        stage('Pre-Upgrade Snapshot') {
            when { expression { return params.CAPTURE_SNAPSHOT } }
            steps {
                withCredentials([string(credentialsId: 'grafana-sentinel-token', variable: 'GRAFANA_TOKEN')]) {
                    script {
                        def grafanaUrl = params.GRAFANA_URL ?: env.GRAFANA_URL
                        def label      = params.SNAPSHOT_LABEL ?: "pre-${BUILD_NUMBER}"
                        sh """
                            node cli/sentinel.js snapshot capture \\
                                --url '${grafanaUrl}' \\
                                --token '${GRAFANA_TOKEN}' \\
                                --output '${SNAPSHOTS_DIR}' \\
                                --label '${label}'
                        """
                        currentBuild.description = "Snapshot: ${label}"
                    }
                }
            }
        }

        stage('Run Tests') {
            steps {
                withCredentials([string(credentialsId: 'grafana-sentinel-token', variable: 'GRAFANA_TOKEN')]) {
                    script {
                        def grafanaUrl = params.GRAFANA_URL ?: env.GRAFANA_URL
                        def testLevel  = params.TEST_LEVEL

                        echo "Running Sentinel tests: ${testLevel} against ${grafanaUrl}"

                        def exitCode = sh(
                            script: """
                                node cli/sentinel.js run \\
                                    --url '${grafanaUrl}' \\
                                    --token '${GRAFANA_TOKEN}' \\
                                    --level '${testLevel}' \\
                                    --report-dir '${REPORTS_DIR}'
                            """,
                            returnStatus: true
                        )

                        if (exitCode != 0) {
                            unstable("Sentinel tests failed with exit code ${exitCode}")
                        }
                    }
                }
            }
        }

        stage('Generate Reports') {
            steps {
                sh """
                    node cli/sentinel.js report executive \\
                        --report-dir '${REPORTS_DIR}' \\
                        --output '${REPORTS_DIR}/executive.html'
                """
            }
        }

        stage('Push Metrics') {
            when {
                allOf {
                    expression { return params.PUSH_METRICS }
                    environment name: 'PUSHGATEWAY_URL', value: ''
                    not { environment name: 'PUSHGATEWAY_URL', value: '' }
                }
            }
            steps {
                sh """
                    node cli/sentinel.js report push \\
                        --pushgateway '${PUSHGATEWAY_URL}' \\
                        --job 'grafana-sentinel-jenkins'
                """
            }
        }

        stage('Notify') {
            when { expression { return env.SLACK_WEBHOOK_URL != null } }
            steps {
                script {
                    def files   = sh(script: "ls -t ${REPORTS_DIR}/*.json 2>/dev/null | head -1", returnStdout: true).trim()
                    def report  = readJSON file: files
                    def summary = report.summary ?: [:]
                    def icon    = (summary.pass_rate ?: 0) >= 80 ? '✅' : (summary.pass_rate ?: 0) >= 60 ? '⚠️' : '❌'

                    slackSend(
                        color: (summary.pass_rate ?: 0) >= 80 ? 'good' : (summary.pass_rate ?: 0) >= 60 ? 'warning' : 'danger',
                        message: "${icon} Grafana Sentinel ${params.TEST_LEVEL} | Pass Rate: ${summary.pass_rate}% | Build: ${BUILD_URL}"
                    )
                }
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'reports/**/*', allowEmptyArchive: true
            publishHTML(target: [
                allowMissing: true,
                alwaysLinkToLastBuild: true,
                keepAll: true,
                reportDir: 'reports',
                reportFiles: 'executive.html',
                reportName: 'Grafana Sentinel Report',
                reportTitles: 'Sentinel'
            ])
        }

        failure {
            script {
                if (env.SLACK_WEBHOOK_URL) {
                    slackSend(
                        color: 'danger',
                        message: "❌ Grafana Sentinel FAILED on ${BRANCH_NAME} — ${BUILD_URL}"
                    )
                }
            }
        }

        cleanup {
            cleanWs(patterns: [[pattern: 'reports/*.json', type: 'EXCLUDE']])
        }
    }
}

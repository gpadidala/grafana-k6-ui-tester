# AI Failure Analysis

When a test fails, Heimdall can send the failure context to an LLM (OpenAI or Anthropic Claude) and get a plain-English explanation with recommended fixes, right next to the red badge in your report.

## Supported providers

| Provider | Models | How to get a key |
|---|---|---|
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo` | <https://platform.openai.com/api-keys> |
| **Anthropic Claude** | `claude-sonnet-4-20250514`, `claude-3-haiku-20240307` | <https://console.anthropic.com/settings/keys> |

## Configure it

Via UI: **Settings → 🤖 LLM Analysis → Provider → paste API key → Save**.

Or via env (backend/.env):

```env
LLM_PROVIDER=openai
LLM_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
LLM_MODEL=gpt-4o-mini
```

## Cost guide

A typical run of 1,000 tests with ~30 failures costs:

| Model | Input tokens | Output tokens | Cost |
|---|---|---|---|
| gpt-4o-mini | ~15k | ~5k | **~$0.003** |
| Claude Sonnet 4 | ~15k | ~5k | **~$0.12** |
| gpt-4o | ~15k | ~5k | **~$0.08** |

For most teams, gpt-4o-mini is the best cost/quality tradeoff.

## Privacy

Only the failing test name, detail, and dashboard/panel title are sent to the LLM — never the full dashboard JSON, never query results, never credentials. You can disable AI analysis by leaving `LLM_API_KEY` empty.

## Related

- [AI Dynamic Test Generator](../getting-started/quick-start.md) — generates test plans from plain English prompts

# LinkedIn AI Wheel

A browser extension that adds a button to each LinkedIn post. Click it to get a
plain-language explanation of the post and an optional fact-check with source
links, produced by an AI provider you choose. It is read-only: it never posts,
comments, likes, or automates anything on LinkedIn.

## Features

- A button at the top-right of each feed post.
- Three modes: Explain, Explain + fact-check, Fact-check.
- Source links when the provider supports live web search.
- Bring your own API key. Keys are stored locally and sent only to the provider you pick.
- Works in Chrome, Edge, and Firefox.

## Providers

| Provider                                  | Live sources | API key |
| ----------------------------------------- | ------------ | ------- |
| Google Gemini (Google Search grounding)   | yes          | https://aistudio.google.com/apikey |
| OpenRouter (web plugin)                    | yes          | https://openrouter.ai/keys |
| Groq                                       | no           | https://console.groq.com/keys |
| OpenAI                                     | no           | https://platform.openai.com/api-keys |
| Anthropic                                  | no           | https://console.anthropic.com/settings/keys |
| Pollinations                               | no           | none |

"Live sources" means the provider fetches and cites current web pages. Providers
without it explain from training data only and return no links.

## Install (unpacked)

### Chrome / Edge

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable Developer mode.
3. Choose "Load unpacked" and select this folder.
4. Open the extension's Settings, choose a provider, paste an API key, and Save.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose "Load Temporary Add-on" and select `manifest.json`.

## Usage

Open the LinkedIn feed. A button appears at the top-right of each post. Click it,
pick a mode, and read the result. Use Copy to copy the text and sources.

## How it works

- `src/content.js` injects the button, locates the post container, reads the post
  text, and renders the result panel.
- `src/background.js` (service worker) calls the selected provider and returns the
  text and any source links. API calls run here, not in the page, so keys are not
  exposed to LinkedIn.
- Settings and keys are stored in `storage.local`.

## Configuration

Everything is on the Settings page: provider, API key (per provider), an optional
model override, and an on/off toggle.

## Limitations

- Desktop browsers only. The LinkedIn mobile app cannot be extended.
- LinkedIn's markup changes often. If the button stops appearing, update the
  selectors at the top of `src/content.js`.
- Fact-checks are AI-generated and can be wrong. Verify the sources.

## Privacy

The post text and your API key are sent only to the provider you select, and only
when you click the button. There is no backend server and no analytics. See
`PRIVACY.md`.

## License

MIT. See `LICENSE`.

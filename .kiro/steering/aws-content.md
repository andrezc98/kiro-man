---
inclusion: fileMatch
fileMatchPattern: "src/content/**"
---

# KIRO-MAN AWS content rules

## Logos, names and trademarks

- No official AWS logos or icons. Use our own pixel art plus text labels (`LMB`, `SHD`, `ASG`, `CDN`, `CWT`).
- Use AWS service names nominatively, spelled as AWS spells them (for example "AWS Lambda", "Amazon CloudWatch").
- Do not use third-party video game trademarks or character names. Do not reproduce any existing commercial maze layout.

## Facts (`src/content/aws-facts.json`)

Every fact must:

- be at most 120 characters;
- be verified against the AWS documentation with the `aws-docs` MCP server (`.kiro/settings/mcp.json`) before it is added;
- carry a `sourceUrl` on `https://docs.aws.amazon.com` or `https://aws.amazon.com` pointing at the page that states it;
- use only pixel-font glyphs after uppercasing (`FONT_GLYPHS` in `src/content/glyphs.ts`);
- have a unique `id` matching `^[a-z0-9-]+$` and a `service` from `services.json` kinds or `dynamodb`.

`src/content/facts.ts` validates all of this at module load and throws on a bad entry. Keep at least 2 facts per power-up kind and at least 2 DynamoDB facts.

## Power-up catalog (`src/content/services.json`)

The single source of truth for the engine, the renderer and the MCP `list_power_ups` tool. Keep the order `lambda, shield, autoscaling, cloudfront, cloudwatch` (`CATALOG_ORDER`), labels `^[A-Z]{3}$`, durations 1..3600 ticks and colors 0..15.

## Disclaimer

Use this exact text wherever a disclaimer is shown (the README uses the same text):

"KIRO-MAN is an independent fan project. It is not affiliated with, endorsed by, or sponsored by Amazon Web Services or any video game publisher. AWS service names are used nominatively. No AWS logos or third-party game assets are included."

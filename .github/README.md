# Skills

Hand-crafted [agent skills](https://github.com/vercel-labs/skills) I built for my own workflows. Each one solves a real problem I kept running into.

## What's in here

| Skill                               | What it does                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| [upload-image](skills/upload-image) | Uploads images to imgbb — local files, URLs, SVGs, base64, whatever. No more manual hosting. |

## Use them

```bash
npx skills@latest add o-az/skills --skill <skill-name>
```

## Make your own

1. Drop a folder in `skills/`
2. Add a `SKILL.md` with `name` and `description` frontmatter
3. That's it. No build step, no config, no ceremony.

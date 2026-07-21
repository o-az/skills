# Skills

Hand-crafted [skills](https://skills.sh) for agents, built from workflows I kept manually repeating.

| Skill                                                            | What it does                                                                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [multilingual-caption-video](/skills/multilingual-caption-video) | Add captions / subtitles to a video in your desired language.                                                                                                                           |
| ~~screencast~~ (Use CDP's new `--experimentalScreencast`)        |
| [manipulating-video](/skills/manipulating-video)                 | Manipulate video files with [`ffmpeg`](https://github.com/ffmpeg/ffmpeg) — speed up/slow down, resize, compress, convert formats, extract audio, convert to GIF, trim, merge, and more. |
| [upload-image](/skills/upload-image)                             | Uploads images to [imgbb](https://ibb.co) — local files, URLs, SVGs, base64, whatever. No more manual hosting.                                                                          |
| [terminal-recording](/skills/terminal-recording)                 | Record, upload, and GIF-convert terminal sessions with [`asciinema`](https://github.com/asciinema/asciinema) and [`agg`](https://github.com/asciinema/agg).                             |
| [ghostty-remote-control](/skills/ghostty-remote-control)         | kitty-inspired `kitten` remote control for agents to control ghostty terminal sessions, tabs, and windows.                                                                              |
| [github-to-markdown](/skills/github-to-markdown)                 | Uses [2md](https://github.com/o-az/2md) to convert a GitHub repo, directory, or file into a single markdown document for LLM or documentation workflows.                                |

> [!NOTE]
> Skills are reusable capabilities for AI agents. They provide procedural knowledge that helps agents accomplish specific tasks more effectively. Skills can include code generation patterns, domain expertise, tool integrations, and more.
> <sub>[skills.sh](https://skills.sh/docs/faq)</sub>

## Install

Install a single skill:

```bash
npx skills@latest add o-az/skills --skill <skill-name>
```

Example:

```bash
npx skills@latest add o-az/skills --skill screencast
```

Install all skills:

```bash
npx skills@latest add o-az/skills --all
```

## Contributing a new Skill

0. Copy skill template

```sh
cp -R _template skills/<new-skill-name>
```

1. Edit `skills/<new-skill-name>/SKILL.md` with the new Skill's name and description
2. Add Skill dependencies to `skills/<new-skill-name>/scripts`
   > See scripts in [`skills/screencast`](/skills/screencast) for a skill dependency example
   > Most Skills won't have dependencies.

#### More on `skills`

- Specification: [agentskills.io/specification](https:/agentskills.io/specification)
- `skills` CLI: [skills.sh/docs/cli](https://skills.sh/docs/cli)

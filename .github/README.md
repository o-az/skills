# Skills

Hand-crafted Skills I built for my workflows. Each one solves a real problem I kept running into.

| Skill                                            | What it does                                                                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [screencast](/skills/screencast)                 | Live-stream browser screencasts over WebSocket so others can watch in real time.                                                                                                        |
| [manipulating-video](/skills/manipulating-video) | Manipulate video files with [`ffmpeg`](https://github.com/ffmpeg/ffmpeg) — speed up/slow down, resize, compress, convert formats, extract audio, convert to GIF, trim, merge, and more. |
| [upload-image](/skills/upload-image)             | Uploads images to [imgbb](https://ibb.co) — local files, URLs, SVGs, base64, whatever. No more manual hosting.                                                                          |
| [terminal-recording](/skills/terminal-recording) | Record, upload, and GIF-convert terminal sessions with [`asciinema`](https://github.com/asciinema/asciinema) and [`agg`](https://github.com/asciinema/agg).                             |

> [!NOTE]
> Skills are reusable capabilities for AI agents. They provide procedural knowledge that helps agents accomplish specific tasks more effectively. Skills can include code generation patterns, domain expertise, tool integrations, and more.
> <sub>[skills.sh](https://skills.sh/docs/faq)</sub>

## How do I use <skill-name>?

Install a single skill:

```bash
npx skills@latest add o-az/skills --skill <skill-name>
```

Install all skills:

```bash
npx skills@latest add o-az/skills --all
```

## Contributing a new Skill

0. Copy skill template

```sh
cp -R skills/template skills/<new-skill-name>
```

1. Edit `skills/<new-skill-name>/SKILL.md` with the new Skill's name and description
2. Add Skill dependencies to `skills/<new-skill-name>/scripts`
   > See scripts in [`skills/screencast`](/skills/screencast) for a skill dependency example
   > Most Skills won't have dependencies.

## Eval Results

Latest results (Iteration 4 — Amp, Opus 4.6):

| Skill                                              | Runs | With Skill | Baseline |   Delta |
| -------------------------------------------------- | ---: | ---------: | -------: | ------: |
| [`manipulating-video`](/skills/manipulating-video) |   30 |     1.0000 |   0.6611 | +0.3389 |
| [`screencast`](/skills/screencast)                 |   60 |     0.9695 |   0.1305 | +0.8390 |
| [`template`](/skills/template)                     |   20 |     1.0000 |   0.4250 | +0.5750 |
| [`terminal-recording`](/skills/terminal-recording) |   32 |     1.0000 |   0.5938 | +0.4062 |
| [`upload-image`](/skills/upload-image)             |   48 |     1.0000 |   0.4305 | +0.5695 |

Full history and benchmark files are in [`evals`](/evals) directory.

<details>

<summary>more on Skills</summary>

- Specification: https://agentskills.io/specification
- `skills` CLI: https://skills.sh/docs/cli

</details>

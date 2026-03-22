# Skills

Hand-crafted Skills I built for my workflows. Each one solves a real problem I kept running into.

| Skill                                            | What it does                                                                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [manipulating-video](/skills/manipulating-video) | Manipulate video files with [`ffmpeg`](https://github.com/ffmpeg/ffmpeg) — speed up/slow down, resize, compress, convert formats, extract audio, convert to GIF, trim, merge, and more. |
| [screencast](/skills/screencast)                 | Live-stream browser screencasts over WebSocket so others can watch in real time.                                                                                                        |
| [terminal-recording](/skills/terminal-recording) | Record, upload, and GIF-convert terminal sessions with [`asciinema`](https://github.com/asciinema/asciinema) and [`agg`](https://github.com/asciinema/agg).                             |
| [upload-image](/skills/upload-image)             | Uploads images to [imgbb](https://ibb.co) — local files, URLs, SVGs, base64, whatever. No more manual hosting.                                                                          |

> [!NOTE]
> Skills are reusable capabilities for AI agents. They provide procedural knowledge that helps agents accomplish specific tasks more effectively. Skills can include code generation patterns, domain expertise, tool integrations, and more.
> <sub>[skills.sh](https://skills.sh/docs/faq)</sub>

## How do I use <skill-name>?

Install a single skill:

```bash
npx skills@latest add o-az/skills --skill <skill-name>
```

Install all skills:

```bashbash
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

### Iteration 4 — Amp

<sub>Opus 4.6</sub>

| Skill                                              | Runs | With Skill | Baseline |   Delta |
| -------------------------------------------------- | ---: | ---------: | -------: | ------: |
| [`manipulating-video`](/skills/manipulating-video) |   30 |     1.0000 |   0.6611 | +0.3389 |
| [`screencast`](/skills/screencast)                 |   60 |     0.9695 |   0.1305 | +0.8390 |
| [`template`](/skills/template)                     |   20 |     1.0000 |   0.4250 | +0.5750 |
| [`terminal-recording`](/skills/terminal-recording) |   32 |     1.0000 |   0.5938 | +0.4062 |
| [`upload-image`](/skills/upload-image)             |   48 |     1.0000 |   0.4305 | +0.5695 |

### Iteration 3 — Codex

<sub>gpt-5.4 medium fast</sub>

Many runs hit `codex exec --ephemeral` sub-session timeouts, depressing with_skill scores.

| Skill                                              | Runs | With Skill | Baseline |   Delta |
| -------------------------------------------------- | ---: | ---------: | -------: | ------: |
| [`manipulating-video`](/skills/manipulating-video) |   30 |     0.6389 |   0.5778 | +0.0611 |
| [`screencast`](/skills/screencast)                 |   60 |     0.3667 |   0.0000 | +0.3667 |
| [`template`](/skills/template)                     |   20 |     0.8250 |   0.2667 | +0.5583 |
| [`terminal-recording`](/skills/terminal-recording) |   32 |     0.6667 |   0.5677 | +0.0990 |
| [`upload-image`](/skills/upload-image)             |   48 |     0.2639 |   0.0417 | +0.2222 |

### Iteration 2 — pi

<sub>claude-opus-4-6</sub>

| Skill                                              | Runs | With Skill | Baseline |   Delta |
| -------------------------------------------------- | ---: | ---------: | -------: | ------: |
| [`manipulating-video`](/skills/manipulating-video) |   30 |     1.0000 |   0.6450 | +0.3550 |
| [`screencast`](/skills/screencast)                 |   60 |     0.9700 |   0.1300 | +0.8400 |
| [`template`](/skills/template)                     |   20 |     1.0000 |   0.3830 | +0.6170 |
| [`terminal-recording`](/skills/terminal-recording) |   32 |     1.0000 |   0.4060 | +0.5940 |
| [`upload-image`](/skills/upload-image)             |   48 |     1.0000 |   0.5000 | +0.5000 |

<details>
<summary>Benchmark file paths</summary>

Iteration 4 (Amp):

- [`evals/manipulating-video/evals/workspace/iteration-4/benchmark.json`](/evals/manipulating-video/evals/workspace/iteration-4/benchmark.json)
- [`evals/screencast/evals/workspace/iteration-4/benchmark.json`](/evals/screencast/evals/workspace/iteration-4/benchmark.json)
- [`evals/template/evals/workspace/iteration-4/benchmark.json`](/evals/template/evals/workspace/iteration-4/benchmark.json)
- [`evals/terminal-recording/evals/workspace/iteration-4/benchmark.json`](/evals/terminal-recording/evals/workspace/iteration-4/benchmark.json)
- [`evals/upload-image/evals/workspace/iteration-4/benchmark.json`](/evals/upload-image/evals/workspace/iteration-4/benchmark.json)

Iteration 3 (Codex):

- [`evals/manipulating-video/evals/workspace/iteration-3/benchmark.json`](/evals/manipulating-video/evals/workspace/iteration-3/benchmark.json)
- [`evals/screencast/evals/workspace/iteration-3/benchmark.json`](/evals/screencast/evals/workspace/iteration-3/benchmark.json)
- [`evals/template/evals/workspace/iteration-3/benchmark.json`](/evals/template/evals/workspace/iteration-3/benchmark.json)
- [`evals/terminal-recording/evals/workspace/iteration-3/benchmark.json`](/evals/terminal-recording/evals/workspace/iteration-3/benchmark.json)
- [`evals/upload-image/evals/workspace/iteration-3/benchmark.json`](/evals/upload-image/evals/workspace/iteration-3/benchmark.json)

Iteration 2 (pi):

- [`evals/manipulating-video/evals/workspace/iteration-2/benchmark.json`](/evals/manipulating-video/evals/workspace/iteration-2/benchmark.json)
- [`evals/screencast/evals/workspace/iteration-2/benchmark.json`](/evals/screencast/evals/workspace/iteration-2/benchmark.json)
- [`evals/template/evals/workspace/iteration-2/benchmark.json`](/evals/template/evals/workspace/iteration-2/benchmark.json)
- [`evals/terminal-recording/evals/workspace/iteration-2/benchmark.json`](/evals/terminal-recording/evals/workspace/iteration-2/benchmark.json)
- [`evals/upload-image/evals/workspace/iteration-2/benchmark.json`](/evals/upload-image/evals/workspace/iteration-2/benchmark.json)

</details>

<details>
<summary>Iteration 1 — Codex (calibration pass, not a benchmark)</summary>

Codex authored the eval specs, improved the skills, then ran single-run evals and graded its own work — all in one session with full context. [It agrees](https://chatgpt.com/codex) this is a "grading my own homework" problem: baselines were intentionally weak, grading was lenient (e.g., screencast without_skill got credit for knowing bundled scripts), and the perfect 1.0 with_skill scores didn't hold up under independent evaluation. Treat as a bootstrap/calibration pass, not a real benchmark.

| Skill                                              | With Skill | Baseline |   Delta |
| -------------------------------------------------- | ---------: | -------: | ------: |
| [`manipulating-video`](/skills/manipulating-video) |     1.0000 |   0.3611 | +0.6389 |
| [`screencast`](/skills/screencast)                 |     1.0000 |   0.5000 | +0.5000 |
| [`template`](/skills/template)                     |     1.0000 |   0.0000 | +1.0000 |
| [`terminal-recording`](/skills/terminal-recording) |     1.0000 |   0.4167 | +0.5833 |
| [`upload-image`](/skills/upload-image)             |     1.0000 |   0.2222 | +0.7778 |

Benchmarks:

- [`evals/manipulating-video/evals/workspace/iteration-1/benchmark.json`](/evals/manipulating-video/evals/workspace/iteration-1/benchmark.json)
- [`evals/screencast/evals/workspace/iteration-1/benchmark.json`](/evals/screencast/evals/workspace/iteration-1/benchmark.json)
- [`evals/template/evals/workspace/iteration-1/benchmark.json`](/evals/template/evals/workspace/iteration-1/benchmark.json)
- [`evals/terminal-recording/evals/workspace/iteration-1/benchmark.json`](/evals/terminal-recording/evals/workspace/iteration-1/benchmark.json)
- [`evals/upload-image/evals/workspace/iteration-1/benchmark.json`](/evals/upload-image/evals/workspace/iteration-1/benchmark.json)

</details>

<details>

<summary>more on Skills</summary>

- Specification: https://agentskills.io/specification
- `skills` CLI: https://skills.sh/docs/cli

</details>

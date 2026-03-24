# Upload-Image Fixture Notes

The harness can generate eval fixtures instead of storing binaries in git.

1. `diagram.png` is generated via `ffmpeg` color source.
2. `logo.svg` is generated as a simple inline SVG file.
3. `test-animation.gif` is generated from a short two-frame animation.

Generation is handled by `evals/harness/scripts/prepare-fixtures.sh`.

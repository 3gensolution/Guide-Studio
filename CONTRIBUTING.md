 # Contribution Guidelines

Thank you for considering contributing to this project! By contributing, you help make this project better for everyone. Please take a moment to review these guidelines to ensure a smooth contribution process.

## How to Contribute

1. **Fork the Repository**
   - Click the "Fork" button at the top right of this repository to create your own copy.

2. **Clone Your Fork**
   - Clone your forked repository to your local machine:
     ```bash
     git clone https://github.com/your-username/Guide-Studio.git
     ```

3. **Create a New Branch**
   - Create a branch for your feature or bug fix:
     ```bash
     git checkout -b feature/your-feature-name
     ```

4. **Make Changes**
   - Make your changes.

5. **Test Your Changes**
   - Test your changes thoroughly to ensure they work as expected and do not break existing functionality.

6. **Commit Your Changes**
   - Commit your changes with a clear and concise commit message:
     ```bash
     git add .
     git commit -m "Add a brief description of your changes"
     ```

7. **Push Your Changes**
   - Push your branch to your forked repository:
     ```bash
     git push origin feature/your-feature-name
     ```

8. **Open a Pull Request**
   - Go to the original repository and open a pull request from your branch. Provide a clear description of your changes and the problem they solve.

## Reporting Issues

If you encounter a bug or have a feature request, please open an issue in the [Issues](https://github.com/3gensolution/Guide-Studio/issues) section of this repository. Provide as much detail as possible to help us address the issue effectively.

## Style Guide

- Write clear, concise, and descriptive commit messages.
- Include comments where necessary to explain complex code.

## Cutting a release

Releases are built and published by [`.github/workflows/release.yml`](.github/workflows/release.yml). Pushing a `v*` tag is the whole process:

```bash
git tag v0.1.3
git push origin v0.1.3
```

That builds macOS (arm64 + x64), Windows, and Linux in parallel, then creates the GitHub Release with every installer attached plus a `SHA256SUMS.txt`. The version baked into the installers comes from the tag, so `package.json` does not need bumping first. A tag containing a hyphen (`v0.2.0-beta.1`) is published as a pre-release.

Re-running the workflow for a tag that already has a release replaces its assets instead of failing, so a failed platform can be retried without deleting the release.

You can also run the workflow manually from the Actions tab and pass a tag; it will create that tag from the commit you run it on.

### Signing

There are no signing certificates in CI, so published builds are unsigned: macOS users clear the quarantine flag and Windows users click through SmartScreen (the release notes say so). To sign properly, add the certificates as repository secrets and set `CSC_LINK`/`CSC_KEY_PASSWORD` (macOS, plus notarization credentials) and `CSC_LINK`/`CSC_KEY_PASSWORD` (Windows) on the relevant jobs.

## License

By contributing to this project, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

Thank you for your contributions!
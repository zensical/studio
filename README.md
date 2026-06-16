<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zensical/studio/master/.github/assets/studio-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/zensical/studio/master/.github/assets/studio.png">
    <img alt="Zensical" src="https://raw.githubusercontent.com/zensical/studio/master/.github/assets/studio.png" >
  </picture>
</p>

<h3 align="center">
  <strong>
    Refactor documentation like code.
  </strong>
</h3>

<p align="center">
  <a href="https://zensical.org/studio/"><strong>Home</strong></a>
  &middot;
  <a href="https://zensical.org/studio/get-started/"><strong>Get started</strong></a>
  &middot;
  <a href="https://zensical.org/studio/about/roadmap/"><strong>Roadmap</strong></a>
  &middot;
  <a href="https://zensical.org/about/newsletter/"><strong>Newsletter</strong></a>
  &middot;
  <a href="https://zensical.org/spark/"><strong>Zensical Spark</strong></a>
</p>

<p align="center">
  Catch [broken links] instantly. Zensical Studio keeps links, headings, and references up to date when you rename, move, or restructure content. Blazing fast and reliable, integrated with your editor.
</p>
<p align="center">
  Works with all <a href="https://zensical.org/studio/">Zensical</a> and MkDocs projects.
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zensical/studio/master/.github/assets/screenshot-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/zensical/studio/master/.github/assets/screenshot.png">
    <img alt="Zensical" src="https://raw.githubusercontent.com/zensical/studio/master/.github/assets/screenshot.png">
  </picture>
</p>

<p align="center">
  <em>
    Zensical Studio in Visual Studio Code. Learn more at
    <a href="https://zensical.org/studio/">zensical.org/studio/</a>.
  </em>
</p>


## Installation

__Zensical Studio is in Public Beta and free to use.__

Install [Zensical Studio in Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=zensical.zensical-studio) and use the editor you already know for writing, validating, and navigating your documentation. We'll add support for other editors in the near future, including Cursor and Zed.

Zensical Studio brings native support for Python Markdown - including accurate syntax highlighting, navigation, refactoring, and validation. To activate Python Markdown support, create `.vscode/settings.json` in your documentation project and add the following:

```json
{
  "files.associations": {
    "*.md": "python-markdown"
  }
}
```

That's all. Zensical Studio will now automatically detect and validate Python Markdown files in your project, and check for broken links, headings, and references. For more information, refer to the [Zensical Studio documentation](https://zensical.org/studio/).

__Supported platforms__

- __Windows__: arch64, x64
- __macOS__: arm64, x64
- __Linux__: arm64, x64

## Support

If you think you've found a bug, or have ideas for improvements, please report them in the [Zensical Studio GitHub repository](https://github.com/zensical/studio/issues). With your feedback, we'll shape Zensical Studio into the authoring environment technical writers and documentation teams want to use.

## License

This repository contains the editor integrations for Zensical Studio, which are licensed under MIT. Zensical Studio is licensed separately under the [EULA](https://github.com/zensical/studio/blob/master/EULA.md). By using Zensical Studio, you agree to the terms of the EULA.

During the Public Beta, Zensical Studio is free to use, and we commit to providing a free tier once the Beta concludes. Our notes on [Open Source sustainability](https://zensical.org/studio/about/sustainability/) explain why we chose this licensing model.

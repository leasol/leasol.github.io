# Packages Studio

The static GitHub Pages studio for the English-language, non-Israel packages
in Quiz: Celebs Game. It is published at `https://leasol.github.io/packages/`.

## Refreshing the catalog

The checked-in `data.json` is a browser-friendly snapshot built from the
Celebs app manifest and package files. With the Celebs app available locally:

```bash
python3 generate_static_data.py
```

Set `ACTORQUIZ_PATH` if the app lives somewhere other than the default sibling
repository. The generator keeps labels English and omits a source-only Hebrew
song package that has no English companion data.

## Adding a package from the studio

Use **Package from data.json** in the live site, enter a name and package ID,
then choose the package's `data.json`. Add the original and AI image folders
when the source follows the ActorQuiz layout; ordinary ActorQuiz data files do
not carry those folder paths themselves. GitHub Pages is static, so this
creates a local browser draft rather than modifying the published catalog.
Use **Export draft** to save it and **Import draft** to restore or share it.

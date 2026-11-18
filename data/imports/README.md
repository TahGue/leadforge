# data/imports

Operator-supplied datasets for the **Open company dataset (file)** source
(`open_dataset` adapter). Files here are mounted read-only into the crawler
container at `/app/data/imports`.

- `sample-registry.csv` is **fictional** sample data (`.example` domains) for
  trying the pipeline. Replace it with a real registry or open-data export.
- Before approving the source in **Sources**, record the dataset's licence,
  terms URL, permitted use and attribution. Only use datasets whose licence
  permits your use (spec section 10).
- Supported formats: CSV (comma, semicolon or tab) and JSON Lines. Column names
  are matched case-insensitively against common registry headers; set
  `config.columns` on the source to map others, `config.country` for a default
  country, and `config.industryScheme` (`NACE` or `SNI`).

Real exports can contain personal data (sole traders). Keep them out of git:
everything in this folder except this README and the sample is ignored.

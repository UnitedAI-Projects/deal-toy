# MantelDocs contributors and provenance

MantelDocs modifications are by **ichen27**. The project retains its upstream history, original copyright notices, and third-party attribution in [NOTICE](../NOTICE) and [ATTRIBUTION.md](../ATTRIBUTION.md).

## About window

**About ▸ Contributors** displays contributor records compiled into the application. There is no Models tab.

- [contributors/contributors.json](../contributors/contributors.json) contains inherited upstream contribution statistics. These are historical records, not a freshly generated report of contributions to MantelDocs.
- [contributors/people.toml](../contributors/people.toml) contains contributor display-name preferences.
- The UI crate compiles these records into the native and browser builds; it does not fetch them at runtime.

The display supports a flowing list or table and sorting by name, contribution counts, and dates. Missing display names fall back to GitHub usernames.

## Updating contributor records

Make changes through a pull request using [CONTRIBUTING.md](../CONTRIBUTING.md). Preserve upstream attribution and only add personal names with the contributor's consent. The current MantelDocs checks do not regenerate contributor statistics; no release-time credits job is configured.

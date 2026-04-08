# Policy Packs

Policy packs are reusable registry fragments.

Import them from `harness/registry.yaml` the same way you import `registry.d` fragments.

Example:

```yaml
imports:
  - ./registry.d/*.yaml
  - ./policies/shared/governance-baseline.yaml
  - ./policies/shared/project-stubs.yaml
```

Use these packs as defaults, then layer project-specific guides and capabilities in your own registry files.

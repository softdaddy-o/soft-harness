# Publishing

## Recommended

Use npm Trusted Publishing through GitHub Actions.

Repository workflow:

- `.github/workflows/publish.yml`

Workflow name:

- `Publish to npm`

## npm Trusted Publisher Settings

Register this GitHub repository as a trusted publisher in npm with:

- owner: `softdaddy-o`
- repository: `soft-harness`
- workflow file: `publish.yml`
- environment: none

Enter those values exactly. npm ties trust to the repository and workflow file name.

## Publish Paths

After the trusted publisher is registered, publish by either:

1. creating a GitHub release
2. running the workflow manually with `workflow_dispatch`

The workflow runs:

1. `npm ci`
2. `npm test`
3. `npm publish --provenance --access public`

## Notes

- No `NPM_TOKEN` secret is required for this workflow.
- The job needs `id-token: write` permission for OIDC.
- If you later add a protected GitHub Environment, the npm trusted publisher entry must include that environment name as well.

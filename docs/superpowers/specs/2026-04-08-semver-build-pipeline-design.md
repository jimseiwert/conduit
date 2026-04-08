# Semver Build Pipeline Design

**Date:** 2026-04-08  
**Status:** Approved

## Problem

The release workflow uses the sanitized `github.ref_name` (e.g. `feature/build` → `feature-build`) as the version string for Helm chart packaging. This is not valid semver, causing `helm package` to fail. Additionally, no single version source of truth exists — Docker tags, VS Code extension version, CLI version, and Helm chart version are all disconnected.

## Goal

Resolve the version once at the start of the workflow and propagate it consistently to all build artifacts: Helm chart, Docker image, VS Code extension, and CLI binary. No `package.json` files are modified; the version is injected as a build-time variable only.

## Design

### 1. `workflow_dispatch` input

Add a required `version` input to manual triggers so the workflow always has a valid semver available:

```yaml
on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Release version (e.g. 1.2.3)'
        required: true
  push:
    tags:
      - "v*.*.*"
```

### 2. `resolve-version` job

A new first job that all other jobs depend on. It strips the `v` prefix from the git tag when triggered by a tag push, or uses the manual input for `workflow_dispatch`:

```yaml
resolve-version:
  name: Resolve version
  runs-on: ubuntu-latest
  outputs:
    version: ${{ steps.ver.outputs.version }}
  steps:
    - id: ver
      run: |
        if [ -n "${{ inputs.version }}" ]; then
          echo "version=${{ inputs.version }}" >> $GITHUB_OUTPUT
        else
          echo "version=${GITHUB_REF_NAME#v}" >> $GITHUB_OUTPUT
        fi
```

All downstream jobs add `resolve-version` to their `needs` and reference the version via `${{ needs.resolve-version.outputs.version }}`.

### 3. Version propagation per artifact

**Helm chart** (`publish-helm` job)  
Remove the "Sanitize ref name for Helm version" step. Use resolved version directly:
```yaml
needs: [build-relay-image, resolve-version]
# ...
helm package apps/relay-chart --version ${{ needs.resolve-version.outputs.version }}
helm push conduit-relay-${{ needs.resolve-version.outputs.version }}.tgz oci://ghcr.io/${{ github.repository_owner }}/charts
```

**Docker image** (`build-relay-image` job)  
Remove the "Sanitize ref name for Docker tag" step. Use resolved version as image tag:
```yaml
needs: [resolve-version]
# ...
tags: |
  ghcr.io/${{ github.repository_owner }}/conduit-relay:latest
  ghcr.io/${{ github.repository_owner }}/conduit-relay:${{ needs.resolve-version.outputs.version }}
```

**VS Code extension** (`build-vscode-ext` job)  
`vsce package` supports a `--version` flag that overrides `package.json` without modifying the file:
```yaml
needs: [resolve-version]
# ...
bunx vsce package --no-dependencies --version ${{ needs.resolve-version.outputs.version }} -o conduit-vscode-ext.vsix
```

**CLI binary** (`build-cli` job)  
Use bun's `--define` flag to bake the version into the binary at compile time. Requires one code change (see section 4):
```yaml
needs: [resolve-version]
# ...
bun build --compile src/index.ts \
  --outfile dist/${{ matrix.binary }} \
  --target bun \
  --external react-devtools-core \
  --define 'process.env.VERSION="${{ needs.resolve-version.outputs.version }}"'
```

### 4. CLI code change

`packages/cli/src/index.ts` line 4 currently has a hardcoded version:
```ts
const VERSION = '1.0.0'
```

Change to read from the environment, with the hardcoded value as a local fallback:
```ts
const VERSION = process.env.VERSION ?? '1.0.0'
```

Bun's `--define` replaces `process.env.VERSION` with the literal string at compile time — no runtime environment variable is needed in the distributed binary.

## Files Changed

| File | Change |
|------|--------|
| `.github/workflows/release.yml` | Add `version` input, add `resolve-version` job, update all 4 downstream jobs |
| `packages/cli/src/index.ts` | Change `const VERSION = '1.0.0'` to `const VERSION = process.env.VERSION ?? '1.0.0'` |

## Out of Scope

- `package.json` version fields are not modified (intentionally — version is build-time only)
- `Chart.yaml` version field is not modified (Helm `--version` flag overrides it at package time)
- No semver validation is added to the `workflow_dispatch` input (can be added later)

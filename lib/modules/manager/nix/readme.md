The [`nix`](https://github.com/NixOS/nix) manager supports:

- [`lockFileMaintenance`](../../../configuration-options.md#lockfilemaintenance) updates for `flake.lock`
- input updates for `flake.lock`

For specifying `packageRules` it is important to know how `depName` and `packageName` are defined for nix updates:

- The `depName` field is equal to the nix flake input name, eg. `nix.inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";` would have the `depName` of `nixpkgs`
- The `packageName` field is equal to the fully-qualified root URL of the package source, eg. `https://github.com/NixOS/nixpkgs` for the above example.

When a `flake.lock` update changes locked flake inputs, Renovate posts a summary table of the changed inputs - with their old and new revisions, dates and, for GitHub, GitLab, Forgejo and Gitea hosted inputs, a link to the compare view - as an "Artifact update notice" comment on the pull request.

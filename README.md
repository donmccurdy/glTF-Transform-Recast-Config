# glTF Transform / Recast NavMesh configuration

Example showing how to create a custom config file for the glTF Transform CLI,
and implement Recast NavMesh generation as a custom command.

References:
- https://gltf-transform.dev/cli-configuration
- https://github.com/isaac-mason/recast-navigation-js

Example:

```bash
# Recast NavMesh (for Recast/Detour only)
gltf-transform recast --config ./config.js --format recast input.glb navmesh.bin

# glTF NavMesh (for all other navigation libraries)
gltf-transform recast --config ./config.js --format glb input.glb navmesh.glb
```

To import a NavMesh in Recast, see Recast [import/export documentation](https://github.com/isaac-mason/recast-navigation-js#importing-and-exporting).

## Installation

This config file is not published to npm. To use it, copy `config.js` into a project directory, and then install dependencies:

```bash
npm install --save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions @gltf-transform/cli recast-navigation
```

## Troubleshooting

If you see `Cannot read properties of null` or other particularly-opaque errors when
using this config file, it's likely that you've run into [dual package hazard](https://nodejs.org/api/packages.html#dual-package-hazard), possibly with a globally-installed
glTF Transform CLI version and a locally installed version. Removing one or the other may resolve
the issue, or you can ensure that a local CLI is used by explicitly providing a path to the
CLI executable:

```bash
node_modules/@gltf-transform/cli/bin/cli.js --config ./config.js --help
```

import { writeFile } from 'node:fs/promises';
import { Validator } from '@gltf-transform/cli';
import { Document, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, uninstance, weld } from '@gltf-transform/functions';
import {
	exportNavMesh,
	exportTileCache,
	getNavMeshPositionsAndIndices,
	init,
} from 'recast-navigation';
import {
	generateSoloNavMesh,
	generateTileCache,
	generateTiledNavMesh,
	tiledNavMeshGeneratorConfigDefaults,
} from 'recast-navigation/generators';

export default {
	extensions: [...ALL_EXTENSIONS],
	onProgramReady: ({ program, io }) => {
		program
			.command('recast', 'Generate navigation mesh with Recast')
			.help(
				`
Generates a NavMesh for a given glTF scene. Use --format=recast for
the Recast/Detour navigation, or --format=glb for all other navigation
libraries. When using the Recast format, tiling may optionally be enabled
by setting --tileSize. To support temporary obstacles, enable --tileCache.
For full documentation on Recast and its options, see:

https://github.com/isaac-mason/recast-navigation-js
			`.trim(),
			)
			.argument('<input>', 'Path to read glTF 2.0 (.glb, .gltf) model')
			.argument('<output>', 'Path to write output navmesh')
			.option('--format <format>', 'NavMesh output format.', {
				validator: ['recast', 'glb'],
				default: 'recast',
			})
			.option(
				'--tileCache <bool>',
				'Generates an additional TileCache output, for temporary obstacles',
				{
					validator: Validator.BOOLEAN,
					default: false,
				},
			)
			.option(
				'--tileSize <int>',
				'Size of tiles on the XZ plane. If tileSize=0, navmesh is not tiled.',
				{
					validator: Validator.NUMBER,
					default: tiledNavMeshGeneratorConfigDefaults.tileSize,
				},
			)
			.option(
				'--borderSize <number>',
				'Size of the non-navigable border around the heightfield.',
				{
					validator: Validator.NUMBER,
					default: tiledNavMeshGeneratorConfigDefaults.borderSize,
				},
			)
			.option('--cellSize <number>', 'XZ-plane cell size to use for fields.', {
				validator: Validator.NUMBER,
				default: tiledNavMeshGeneratorConfigDefaults.cs,
			})
			.option('--cellHeight <number>', 'Y-axis cell size to use for fields.', {
				validator: Validator.NUMBER,
				default: tiledNavMeshGeneratorConfigDefaults.ch,
			})
			.option(
				'--detailSampleDist <number>',
				'Sets the sampling distance to use when generating the detail mesh. (For height detail only.)',
				{
					validator: Validator.NUMBER,
					default: tiledNavMeshGeneratorConfigDefaults.detailSampleDist,
				},
			)
			.option(
				'--detailSampleMaxError <number>',
				'Maximum distance the detail mesh surface should deviate from heightfield data. (For height detail only.)',
				{
					validator: Validator.NUMBER,
					default: tiledNavMeshGeneratorConfigDefaults.detailSampleMaxError,
				},
			)
			.option(
				'--maxEdgeLen <number>',
				'Maximum allowed length for contour edges along the border of the mesh.',
				{
					validator: Validator.NUMBER,
					default: tiledNavMeshGeneratorConfigDefaults.maxEdgeLen,
				},
			)
			.option(
				'--maxSimplificationError <number>',
				"Maximum distance a simplfied contour's border edges should deviate the original raw contour.",
				{
					validator: Validator.NUMBER,
					default: tiledNavMeshGeneratorConfigDefaults.maxSimplificationError,
				},
			)
			.option(
				'--maxVertsPerPoly <number>',
				'Maximum number of vertices allowed for polygons generated during the be merged with larger regions.',
				{
					validator: Validator.NUMBER,
					default: tiledNavMeshGeneratorConfigDefaults.maxVertsPerPoly,
				},
			)
			.option(
				'--mergeRegionArea <number>',
				'Any regions with a span count smaller than this value will, if possible, be merged with larger regions.',
				{
					validator: Validator.NUMBER,
					default: tiledNavMeshGeneratorConfigDefaults.mergeRegionArea,
				},
			)
			.option(
				'--minRegionArea <number>',
				'Minimum number of cells allowed to form isolated island areas.',
				{
					validator: Validator.NUMBER,
					default: tiledNavMeshGeneratorConfigDefaults.minRegionArea,
				},
			)
			.option(
				'--walkableClimb <number>',
				'Maximum ledge height that is considered to still be traversable.',
				{
					validator: Validator.NUMBER,
					default: tiledNavMeshGeneratorConfigDefaults.walkableClimb,
				},
			)
			.option(
				'--walkableHeight <number>',
				'Minimum floor to "ceiling" height that will still allow the floor area to be considered walkable.',
				{
					validator: Validator.NUMBER,
					default: tiledNavMeshGeneratorConfigDefaults.walkableHeight,
				},
			)
			.option(
				'--walkableRadius <number>',
				'Distance to erode/shrink the walkable area of the heightfield away from obstructions.',
				{
					validator: Validator.NUMBER,
					default: tiledNavMeshGeneratorConfigDefaults.walkableRadius,
				},
			)
			.option(
				'--walkableSlopeAngle <number>',
				'Maximum slope that is considered walkable.',
				{
					validator: Validator.NUMBER,
					default: tiledNavMeshGeneratorConfigDefaults.walkableSlopeAngle,
				},
			)
			.action(async ({ args, options, logger }) => {
				const document = (await io.read(args.input)).setLogger(logger);

				// Prepare glTF for simpler processing. Weld calls compactPrimitive(prim)
				// for each Primitive, avoiding duplicating vertices when joining geometry.
				await document.transform(
					weld({ overwrite: true }),
					dequantize(),
					uninstance(),
				);

				await init();

				const { navMesh, tileCache } = createNavMesh(document, options);

				if (options.format === 'recast') {
					const bytes = tileCache
						? exportTileCache(navMesh, tileCache)
						: exportNavMesh(navMesh);
					await writeFile(args.output, bytes);
				} else {
					const navMeshDocument = createNavMeshGLB(navMesh).setLogger(logger);
					await io.write(args.output, navMeshDocument);
				}
			});
	},
};

/** Construct a single-node glTF document containing only the NavMesh. */
function createNavMeshGLB(navMesh) {
	const [positionsArray, indicesArray] = getNavMeshPositionsAndIndices(navMesh);

	const document = new Document();
	const buffer = document.createBuffer();
	const position = document
		.createAccessor()
		.setType('VEC3')
		.setArray(new Float32Array(positionsArray))
		.setBuffer(buffer);
	const indices = document
		.createAccessor()
		.setType('SCALAR')
		.setArray(new Uint32Array(indicesArray))
		.setBuffer(buffer);
	const prim = document
		.createPrimitive()
		.setIndices(indices)
		.setAttribute('POSITION', position);
	const mesh = document.createMesh().addPrimitive(prim);
	const node = document.createNode().setMesh(mesh);
	const scene = document.createScene().addChild(node);
	document.getRoot().setDefaultScene(scene);
	return document;
}

/** Construct a Recast NavMesh from a given glTF document. */
function createNavMesh(document, config) {
	const recastConfig = {
		...config,
		cs: config.cellSize,
		ch: config.cellHeight,
	};

	const { positions, indices } = extractGeometry(document);

	let result;
	if (config.tileCache) {
		result = generateTileCache(positions, indices, recastConfig);
	} else if (config.tileSize > 0) {
		result = generateTiledNavMesh(positions, indices, recastConfig);
	} else {
		result = generateSoloNavMesh(positions, indices, recastConfig);
	}

	if (!result.success) {
		throw new Error(result.error);
	}

	return { navMesh: result.navMesh, tileCache: result.tileCache };
}

/** From an input glTF Document, extract all geometry into a single mesh primitive. */
function extractGeometry(document) {
	const scene =
		document.getRoot().getDefaultScene() || document.getRoot().listScenes()[0];

	const primList = [];

	let vertexCount = 0;
	let indexCount = 0;

	// Traverse the scene, compiling a list of primitive/matrix pairs.
	scene.traverse((node) => {
		const mesh = node.getMesh();
		if (!mesh) return;

		const worldMatrix = node.getWorldMatrix();
		for (const prim of mesh.listPrimitives()) {
			if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
			vertexCount += prim.getAttribute('POSITION').getCount();
			indexCount += prim.getIndices().getCount();
			primList.push([prim, worldMatrix]);
		}
	});

	// Allocate vertex positions and indices for full scene.
	const positions = new Float32Array(vertexCount * 3);
	const indices = new Uint32Array(indexCount);

	let vertexOffset = 0;
	let indexOffset = 0;

	// For each primitive/matrix pair, append to the joined vertex list.
	for (const [prim, matrix] of primList) {
		const primPositions = prim.getAttribute('POSITION').getArray();
		const primIndices = prim.getIndices().getArray();

		const v = [0, 0, 0];
		for (let i = 0; i < primPositions.length; i++) {
			v[0] = primPositions[i * 3 + 0];
			v[1] = primPositions[i * 3 + 1];
			v[2] = primPositions[i * 3 + 2];
			transformMat4(v, v, matrix);
			positions[(vertexOffset + i) * 3 + 0] = v[0];
			positions[(vertexOffset + i) * 3 + 1] = v[1];
			positions[(vertexOffset + i) * 3 + 2] = v[2];
		}

		for (let i = 0; i < primIndices.length; i++) {
			indices[indexOffset + i] = vertexOffset + primIndices[i];
		}

		vertexOffset += primPositions.length;
		indexOffset += primIndices.length;
	}

	return { positions, indices };
}

/**
 * Transforms the vec3 with a mat4.
 * @source gl-matrix, MIT License
 */
function transformMat4(out, a, m) {
	const x = a[0];
	const y = a[1];
	const z = a[2];

	let w = m[3] * x + m[7] * y + m[11] * z + m[15];
	w = w || 1.0;

	out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
	out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
	out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;

	return out;
}

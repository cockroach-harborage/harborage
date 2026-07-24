// The set of signed knowledge packs and their source files (ARCHITECTURE §5.6,
// §12 M1). Each pack bundles one or more PUBLIC-PLAINTEXT content files; the
// offline m-of-n project key signs the built pack out of band (never in CI).
//
// A pack member is `{ path, source }`: `path` is the logical key inside the pack
// (and the manifest), `source` is the repo-relative file the bytes come from.
export const PACKS = [
	{
		name: 'crisis-cards',
		epoch: 1,
		members: [{ path: 'crisis-cards/cards.json', source: 'content/crisis-cards/cards.json' }]
	}
];

/** Where a built pack is written / read (served as a static asset, precached). */
export function packFilename(pack) {
	return `${pack.name}-v${pack.epoch}.harborage-pack`;
}

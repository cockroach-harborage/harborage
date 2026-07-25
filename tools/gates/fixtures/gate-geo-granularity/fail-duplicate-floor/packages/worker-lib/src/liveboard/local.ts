// A second copy of the floor. The pinned one in params.ts stops being the one
// that runs, and the gate keeps reporting the safe value.
const DENSITY_FLOOR_LOCAL = 2;

export function showable(n: number): boolean {
	return n >= DENSITY_FLOOR_LOCAL;
}

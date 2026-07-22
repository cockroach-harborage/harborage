// Honest connection state, shown as a quiet strip — never a scary modal.
export const network = $state({ online: true });

export function watchNetwork(): () => void {
	network.online = navigator.onLine;
	const on = () => (network.online = true);
	const off = () => (network.online = false);
	addEventListener('online', on);
	addEventListener('offline', off);
	return () => {
		removeEventListener('online', on);
		removeEventListener('offline', off);
	};
}

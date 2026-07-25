// PASS fixture. request.cf.asn is read deliberately: it is not a position, and
// it shards the rate limiter. The coordinate fields next to it are never touched.
export const app = {
	report(c) {
		// THE HOLE. Cloudflare attaches a position to every request and nothing
		// stopped a Worker taking it.
		const asn = c.req.raw.cf?.asn;
		const lat = c.req.raw.cf?.latitude;
		const lon = c.req.raw.cf?.longitude;
		return { asn, lat, lon };
	}
};

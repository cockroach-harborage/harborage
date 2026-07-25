// PASS fixture. request.cf.asn is read deliberately: it is not a position, and
// it shards the rate limiter. The coordinate fields next to it are never touched.
export const app = {
	report(c) {
		const asn = c.req.raw.cf?.asn;
		return { asn };
	}
};

const config = {
	kit: {
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['none'],
				'script-src': ['self'],
				'style-src': ['self'],
				'connect-src': ['self'],
				'img-src': ['self', 'data:'],
				'worker-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['none'],
				'form-action': ['none'],
				'frame-ancestors': ['none'],
				'require-trusted-types-for': ['script'],
				'trusted-types': ['default']
			}
		}
	}
};
export default config;

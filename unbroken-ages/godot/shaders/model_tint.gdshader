// Map props (trees, mountains, buildings): the model's own colour-atlas texture (KayKit / Kenney), harmonised with the
// photographic terrain: the kit's olive "grass" is shifted to a natural green, saturation is pulled toward the aerial
// textures, the instance colour multiplies (foliage variants), and instance alpha below 0.75 turns it into the sepia
// "remembered map" of the fog of war.
shader_type spatial;
render_mode diffuse_burley;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec4 albedo_color : source_color = vec4(1.0);
uniform vec2 uv_scale = vec2(1.0);
uniform vec2 uv_offset = vec2(0.0);
uniform float roughness = 0.85;
uniform float saturation = 0.82;

vec3 rgb2hsv(vec3 c) {
	vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
	vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
	vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
	float d = q.x - min(q.w, q.y);
	return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}

vec3 hsv2rgb(vec3 c) {
	vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
	return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void vertex() {
	UV = UV * uv_scale + uv_offset;
}

void fragment() {
	vec4 tint = COLOR;
	vec3 c = texture(albedo_tex, UV).rgb * albedo_color.rgb;
	vec3 hsv = rgb2hsv(c);
	if (hsv.x > 0.13 && hsv.x < 0.21 && hsv.y > 0.45) {            // olive / yellow grass → meadow green
		hsv.x = 0.25; hsv.y *= 0.75; hsv.z *= 0.72;
	} else if (hsv.x > 0.36 && hsv.x < 0.5 && hsv.y > 0.5) {         // emerald foliage → deeper forest green
		hsv.x = 0.33; hsv.y *= 0.8; hsv.z *= 0.7;
	}
	hsv.y *= saturation;
	c = hsv2rgb(hsv) * tint.rgb;
	if (tint.a < 0.75) {
		float l = dot(c, vec3(0.3, 0.59, 0.11));
		c = vec3(l) * vec3(1.05, 0.92, 0.72) * 0.8;
	}
	ALBEDO = c;
	ROUGHNESS = roughness;
	SPECULAR = 0.3;
}

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
uniform float palette = 0.0;
uniform float team_on = 0.0;                                      // repaint the kit's team-blue in this nation's colour
uniform vec3 team_color : source_color = vec3(0.2, 0.4, 0.85);   // palette-textured kits: sample the top mip only
uniform float sway = 0.0;   // foliage: tops move in the wind, each tree on its own rhythm

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

varying vec4 glow;   // INSTANCE_CUSTOM: rgb = glow colour, a = strength (future cities, path units)
varying vec3 wpos;
varying vec3 wnormal;
varying float above;   // height above the model's own base (its origin), for contact shading

void vertex() {
	glow = INSTANCE_CUSTOM;
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnormal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	above = wpos.y - MODEL_MATRIX[3].y;
	UV = UV * uv_scale + uv_offset;
	if (sway > 0.0) {
		vec3 origin = MODEL_MATRIX[3].xyz;
		float t = TIME * 1.3 + origin.x * 0.7 + origin.z * 0.9;
		float h = max(VERTEX.y, 0.0);
		VERTEX.x += sin(t) * h * h * 0.0035;
		VERTEX.z += cos(t * 0.8) * h * h * 0.0025;
	}
}

void fragment() {
	vec4 tint = COLOR;
	vec3 c = (palette > 0.5 ? textureLod(albedo_tex, UV, 0.0).rgb : texture(albedo_tex, UV).rgb) * albedo_color.rgb;
	float lum0 = dot(c, vec3(0.3, 0.59, 0.11));
	vec3 hsv = rgb2hsv(c);
	bool team = team_on > 0.5 && hsv.x > 0.5 && hsv.x < 0.68 && hsv.y > 0.45;
	if (team) {
		// the kit's team blue: keep its light and shade, take the nation's hue
		c = team_color * clamp(hsv.z / 0.88, 0.35, 1.25);
		hsv = rgb2hsv(c);
	} else if (hsv.x > 0.13 && hsv.x < 0.21 && hsv.y > 0.45) {            // olive / yellow grass → meadow green
		hsv.x = 0.25; hsv.y *= 0.75; hsv.z *= 0.72;
	} else if (hsv.x > 0.36 && hsv.x < 0.5 && hsv.y > 0.5) {         // emerald foliage → deeper forest green
		hsv.x = 0.33; hsv.y *= 0.8; hsv.z *= 0.7;
	}
	hsv.y *= saturation;
	c = hsv2rgb(hsv) * tint.rgb;
	if (tint.a >= 0.75) {
		// A painted finish: a little colour drift across each surface, light from the sky above and a darker seat where the
		// model meets the ground (so it stands in the land rather than on it).
		vec3 q = wpos * 3.1;
		float drift = fract(sin(dot(floor(q), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
		c *= 0.95 + 0.08 * drift;
		c *= 0.9 + 0.16 * clamp(wnormal.y, 0.0, 1.0);
		c *= mix(0.6, 1.0, smoothstep(0.0, 0.14, above));
	}
	if (tint.a < 0.75) {
		// remembered: drawn in sepia ink, with cross-hatching in the darker tones, like a cartographer's sketch
		float l = dot(c, vec3(0.3, 0.59, 0.11));
		vec2 px = FRAGCOORD.xy;
		float hatch1 = step(0.5, fract((px.x + px.y) / 5.0));
		float hatch2 = step(0.5, fract((px.x - px.y) / 5.0));
		float shade = l < 0.32 ? hatch1 * hatch2 : (l < 0.55 ? hatch1 : 1.0);
		c = mix(vec3(0.24, 0.16, 0.10), vec3(0.70, 0.59, 0.42), 0.3 + 0.55 * shade * smoothstep(0.1, 0.7, l + 0.25));
	}
	ALBEDO = c;
	if (tint.a >= 0.75 && glow.a > 0.0) {
		// light from within: the bright parts of the model (windows, panels, veins) shine in the path's colour
		// at full strength the whole surface breathes faintly (living things), not only its bright details
		float base = 0.06 + 0.3 * smoothstep(0.85, 1.0, glow.a) * (0.75 + 0.25 * sin(TIME * 1.4 + MODEL_MATRIX[3].x));
		EMISSION = glow.rgb * glow.a * (base + 1.6 * smoothstep(0.72, 0.95, lum0));
	}
	if (tint.a >= 0.75) {
		// rim light: the sky catching the silhouette, so figures and buildings separate from the ground
		float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
		EMISSION += vec3(1.0, 0.9, 0.72) * rim * 0.14 * (0.5 + 0.5 * clamp(wnormal.y + 0.5, 0.0, 1.0));
	}
	ROUGHNESS = roughness;
	SPECULAR = 0.35;
}

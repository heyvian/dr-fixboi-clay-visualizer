export const surfaceBumpShader = `
vec3 surfaceBumpNormal(vec3 surface, vec3 surfaceNormal, float elevation, float facing) {
  vec3 tangentX = dFdx(surface);
  vec3 tangentY = dFdy(surface);
  vec3 acrossX = cross(tangentY, surfaceNormal);
  vec3 acrossY = cross(surfaceNormal, tangentX);
  float orientation = dot(tangentX, acrossX) * facing;
  vec3 gradient = sign(orientation) * (dFdx(elevation) * acrossX + dFdy(elevation) * acrossY);
  return normalize(max(abs(orientation), 0.00000001) * surfaceNormal - gradient);
}
`;

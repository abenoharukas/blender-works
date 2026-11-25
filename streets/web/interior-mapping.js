// Procedural 3D Parallax Interior Mapping for Japanese residential (一戸建て) & commercial windows.
// Patches Three.js MeshStandardMaterial via onBeforeCompile so zero extra geometry is needed
// while preserving PBR Fresnel sky reflections, dynamic PMREM env maps, and atmosphere.js day/night
// emissiveIntensity transitions — and keeping fallback 2D textures intact for GLTFExporter.

const VARIANT_MODES = {
  living_warm: 0,
  modern_led: 1,
  office_cool: 2,
  amber_shoji: 3,
  unlit_curtain: 4,
  unlit_blinds: 5,
};

function buildInteriorFragmentHelpers(modeId) {
  return /* glsl */ `
varying vec3 vImWorldPos;
varying vec3 vImWorldNormal;
varying vec2 vImUv;

const int IM_MODE = ${modeId};

float imHash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

vec3 imHash31( float p ) {
  vec3 p3 = fract( vec3( p ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.xxy + p3.yzz ) * p3.zyx );
}

float imBox( vec2 p, vec2 lo, vec2 hi ) {
  vec2 s = step( lo, p ) * step( p, hi );
  return s.x * s.y;
}

struct ImResult {
  vec3 albedo;
  vec3 emission;
};

ImResult imEvaluateRoom( vec3 worldPos, vec3 worldNormal, vec2 rawUv ) {
  ImResult res;
  res.albedo = vec3( 0.025 );
  res.emission = vec3( 0.0 );

  vec3 N = normalize( worldNormal );
  // Thin top/bottom rim faces of the window pane box (hidden inside jambs)
  if ( abs( N.y ) > 0.92 ) {
    return res;
  }

  // Decode per-window cell seed & true aspect ratio packed into integer UV offsets:
  //   cellX = 0..127 random room seed
  //   cellY = round(aspect * 10)  (fallback to 1.2 if raw UV is in [0..1])
  vec2 cell = floor( rawUv );
  vec2 uv = fract( rawUv );
  float seed = cell.x + cell.y * 0.37 + imHash12( cell + vec2( 17.3, 41.7 ) ) * 97.0;
  float aspect = ( cell.y >= 2.0 ) ? clamp( cell.y * 0.1, 0.4, 3.6 ) : 1.2;

  vec3 r1 = imHash31( seed + 1.13 );
  vec3 r2 = imHash31( seed + 19.71 );
  vec3 r3 = imHash31( seed + 53.29 );

  // Construct window-plane tangent frame (B = world up, T = horizontal +u)
  vec3 B = vec3( 0.0, 1.0, 0.0 );
  vec3 T = normalize( cross( B, N ) );
  vec3 rayWorld = normalize( worldPos - cameraPosition );

  float ndotv = clamp( dot( N, -rayWorld ), 0.0, 1.0 );
  float fresnel = pow( 1.0 - ndotv, 4.0 );

  // View ray expressed in window-local right / up / outward-normal coordinates
  vec3 d = vec3( dot( rayWorld, T ), dot( rayWorld, B ), min( dot( rayWorld, N ), -0.002 ) );

  // Special case: traditional Machiya Shoji paper (障子)
  // Translucent washi paper sits right behind wooden mullions, showing soft diffused parallax depth.
  if ( IM_MODE == 3 ) {
    vec2 pShoji = vec2( ( uv.x - 0.5 ) * aspect, uv.y - 0.5 );
    vec2 innerOff = pShoji + d.xy * ( -0.55 / d.z );
    vec2 lampDelta = ( innerOff - vec2( ( r1.x - 0.5 ) * 0.35, 0.32 ) ) * vec2( 1.5, 1.9 );
    float lampGlow = exp( -dot( lampDelta, lampDelta ) );
    float lowShadow = smoothstep( -0.52, 0.0, innerOff.y );
    float plantSil = 1.0 - 0.45 * exp( -pow( ( innerOff.x - ( r1.y - 0.5 ) * 0.65 ) * 4.5, 2.0 ) ) *
                     smoothstep( 0.10, -0.35, innerOff.y );

    // Fine washi paper + wooden shoji kumiko lattice (障子桟)
    float gx = abs( fract( uv.x * max( 3.0, floor( aspect * 3.5 + 0.5 ) ) ) - 0.5 );
    float gy = abs( fract( uv.y * 5.0 ) - 0.5 );
    float woodGrid = clamp( 1.0 - ( step( 0.445, gx ) + step( 0.445, gy ) ), 0.0, 1.0 );

    vec3 paperTint = mix( vec3( 0.94, 0.46, 0.14 ), vec3( 1.0, 0.60, 0.22 ), r1.z );
    float warmLevel = ( 0.24 + 0.52 * lampGlow + 0.16 * lowShadow ) * plantSil;
    vec3 woodCol = vec3( 0.04, 0.02, 0.01 );

    float jambVig = smoothstep( 0.0, 0.07, min( min( uv.x, 1.0 - uv.x ), min( uv.y, 1.0 - uv.y ) ) );
    vec3 shojiEmit = mix( woodCol * 0.25, paperTint * warmLevel, woodGrid ) * ( 0.72 + 0.28 * jambVig );
    vec3 shojiAlb  = mix( woodCol, vec3( 0.46, 0.39, 0.30 ) * ( 0.72 + 0.28 * lowShadow ), woodGrid ) *
                     ( 0.75 + 0.25 * jambVig );

    res.albedo = shojiAlb * ( 1.0 - 0.35 * fresnel );
    res.emission = shojiEmit * ( 0.78 + 0.38 * r2.x ) * ( 1.0 - 0.40 * fresnel );
    return res;
  }

  // Tight room box proportioned around the window opening (1.0 = window height, aspect = window width)
  // Keeping room walls just slightly outside the window jambs makes side walls, ceiling & floor
  // immediately visible with strong 3D parallax even at moderate street viewing angles.
  float hw = aspect * 0.5;
  float rx = hw * ( 1.05 + r1.x * 0.16 );
  float ry = 0.54 + r1.y * 0.08;
  float rz = 1.05 + r1.z * 0.65;
  float winOffsetY = 0.03;

  vec3 p = vec3( ( uv.x - 0.5 ) * aspect, ( uv.y - 0.5 ) + winOffsetY, 0.0 );

  // Analytic ray-box intersection against the 5 interior planes
  float tx = ( abs( d.x ) > 1e-4 ) ? ( ( d.x > 0.0 ? rx : -rx ) - p.x ) / d.x : 1e6;
  float ty = ( abs( d.y ) > 1e-4 ) ? ( ( d.y > 0.0 ? ry : -ry ) - p.y ) / d.y : 1e6;
  float tz = ( -rz - p.z ) / d.z;

  float t = min( tz, min( tx, ty ) );
  vec3 hit = p + d * t;

  // Hit face: 0 = back wall, 1 = left/right side wall, 2 = ceiling, 3 = floor
  int face = 0;
  if ( t == tx ) {
    face = 1;
  } else if ( t == ty ) {
    face = ( d.y > 0.0 ) ? 2 : 3;
  }

  float uBack = clamp( hit.x / rx * 0.5 + 0.5, 0.0, 1.0 );
  float vVert = clamp( hit.y / ry * 0.5 + 0.5, 0.0, 1.0 ); // 0 = floor, 1 = ceiling
  float uDepth = clamp( -hit.z / rz, 0.0, 1.0 );           // 0 = window, 1 = back wall

  // Per-variant linear room palettes — calibrated for crisp 3D plane separation under ACES Filmic
  vec3 backCol;
  vec3 sideCol;
  vec3 ceilCol;
  vec3 floorCol;
  vec3 lightCol;
  float isOffice = ( IM_MODE == 2 || IM_MODE == 5 ) ? 1.0 : 0.0;
  float isLit = ( IM_MODE <= 2 ) ? 1.0 : 0.0;

  if ( IM_MODE == 0 ) {
    // living_warm: cozy Japanese LDK (warm cream back wall, shaded taupe side walls, dark oak floor)
    backCol  = mix( vec3( 0.64, 0.46, 0.28 ), vec3( 0.74, 0.56, 0.36 ), r2.x );
    sideCol  = backCol * vec3( 0.52, 0.48, 0.44 );
    ceilCol  = vec3( 0.42, 0.36, 0.30 );
    floorCol = mix( vec3( 0.15, 0.08, 0.035 ), vec3( 0.24, 0.14, 0.06 ), r2.y );
    lightCol = mix( vec3( 1.00, 0.62, 0.24 ), vec3( 1.00, 0.74, 0.38 ), r2.z );
  } else if ( IM_MODE == 1 ) {
    // modern_led: crisp modern Japanese home (neutral off-white/greige walls, warm-daylight LED)
    backCol  = mix( vec3( 0.56, 0.54, 0.50 ), vec3( 0.70, 0.65, 0.58 ), r2.x );
    sideCol  = backCol * vec3( 0.50, 0.51, 0.54 );
    ceilCol  = vec3( 0.40, 0.40, 0.42 );
    floorCol = mix( vec3( 0.18, 0.12, 0.07 ), vec3( 0.13, 0.12, 0.11 ), r2.y );
    lightCol = mix( vec3( 1.00, 0.84, 0.62 ), vec3( 0.94, 0.92, 0.86 ), r2.z );
  } else if ( IM_MODE == 2 ) {
    // office_cool: commercial 2F+ office/clinic (cool fluorescent troffers, pale walls, slate floor)
    backCol  = mix( vec3( 0.52, 0.58, 0.66 ), vec3( 0.66, 0.70, 0.74 ), r2.x );
    sideCol  = backCol * vec3( 0.50, 0.54, 0.60 );
    ceilCol  = vec3( 0.36, 0.40, 0.45 );
    floorCol = vec3( 0.10, 0.12, 0.15 );
    lightCol = mix( vec3( 0.70, 0.86, 1.00 ), vec3( 0.85, 0.94, 1.00 ), r2.z );
  } else {
    // unlit_curtain / unlit_blinds: dark room with legible 3D planes & subtle sky/street bounce
    backCol  = mix( vec3( 0.14, 0.17, 0.21 ), vec3( 0.20, 0.19, 0.17 ), r2.x );
    sideCol  = backCol * 0.58;
    ceilCol  = vec3( 0.16, 0.19, 0.23 );
    floorCol = vec3( 0.07, 0.06, 0.055 );
    lightCol = vec3( 0.0 );
  }

  // Crisp corner & edge ambient occlusion so all 5 box creases read sharply
  float edgeX = 1.0 - abs( hit.x ) / rx;
  float edgeY = 1.0 - abs( hit.y ) / ry;
  float edgeZ = 1.0 - uDepth;
  float aoX = smoothstep( 0.0, 0.14, edgeX );
  float aoY = smoothstep( 0.0, 0.14, edgeY );
  float aoZ = smoothstep( 0.0, 0.16, edgeZ );
  float cornerAo = 0.28 + 0.72 * (
    ( face == 0 ) ? ( aoX * aoY ) :
    ( face == 1 ) ? ( aoY * aoZ ) :
                    ( aoX * aoZ )
  );

  // Distance falloff from ceiling light centered at (0, ry, -rz * 0.42)
  vec3 lampPos = vec3( 0.0, ry * 0.98, -rz * 0.42 );
  float lampDist = length( ( hit - lampPos ) / vec3( rx * 1.1, ry * 1.2, rz * 0.85 ) );
  float lampFalloff = 1.0 / ( 0.65 + lampDist * lampDist * 1.45 );

  vec3 surfCol = backCol;
  float fixtureBoost = 0.0;

  if ( face == 0 ) {
    // Back wall: dark wood baseboard, crown trim, plus architectural wall detail (art / bookshelf / fusuma)
    float baseboard = step( vVert, 0.10 );
    float crown = step( 0.93, vVert );
    surfCol = mix( backCol, floorCol * 0.55, baseboard );
    surfCol = mix( surfCol, ceilCol * 0.62, crown );

    if ( isOffice < 0.5 ) {
      if ( r3.x < 0.45 ) {
        // Framed painting / wall art + wooden credenza below
        float artX = 0.30 + r3.y * 0.40;
        float frame = imBox( vec2( uBack, vVert ), vec2( artX - 0.15, 0.52 ), vec2( artX + 0.15, 0.80 ) );
        float inner = imBox( vec2( uBack, vVert ), vec2( artX - 0.12, 0.55 ), vec2( artX + 0.12, 0.77 ) );
        vec3 artCol = mix( vec3( 0.06, 0.04, 0.03 ), vec3( 0.36, 0.30, 0.22 ), inner );
        surfCol = mix( surfCol, artCol, frame );
      } else if ( r3.x < 0.82 ) {
        // Tall Japanese wooden bookshelf / closet unit on one side of back wall
        float side = ( r3.y < 0.5 ) ? 0.06 : 0.60;
        float cab = imBox( vec2( uBack, vVert ), vec2( side, 0.10 ), vec2( side + 0.34, 0.86 ) );
        float shelfLine = step( 0.80, fract( vVert * 6.5 ) );
        surfCol = mix( surfCol, mix( vec3( 0.12, 0.07, 0.04 ), vec3( 0.34, 0.24, 0.16 ), shelfLine ), cab );
      } else {
        // Accent wall stripe / fusuma sliding door divider
        float door = imBox( vec2( uBack, vVert ), vec2( 0.54, 0.10 ), vec2( 0.92, 0.85 ) );
        float trim = imBox( vec2( uBack, vVert ), vec2( 0.52, 0.10 ), vec2( 0.94, 0.87 ) ) - door;
        surfCol = mix( surfCol, backCol * 0.68, door );
        surfCol = mix( surfCol, floorCol * 0.5, clamp( trim, 0.0, 1.0 ) );
      }
    } else {
      // Office whiteboard / dark filing cabinets along back wall
      float board = imBox( vec2( uBack, vVert ), vec2( 0.18, 0.48 ), vec2( 0.82, 0.82 ) );
      float cabs = imBox( vec2( uBack, vVert ), vec2( 0.08, 0.10 ), vec2( 0.92, 0.38 ) );
      surfCol = mix( surfCol, vec3( 0.86, 0.90, 0.94 ), board * 0.85 );
      surfCol = mix( surfCol, vec3( 0.14, 0.17, 0.22 ), cabs * 0.85 );
    }
  } else if ( face == 1 ) {
    // Left/Right side walls: distinctly shaded vs back wall + baseboard + crown + optional interior door
    float baseboard = step( vVert, 0.10 );
    float crown = step( 0.93, vVert );
    // Left vs right subtle asymmetry makes opposing side walls read crisply
    float sideShade = ( hit.x > 0.0 ) ? 0.92 : 1.08;
    surfCol = sideCol * sideShade * ( 1.08 - 0.32 * uDepth );
    surfCol = mix( surfCol, floorCol * 0.45, baseboard );
    surfCol = mix( surfCol, ceilCol * 0.55, crown );
    if ( r3.z > 0.40 ) {
      float doorMask = imBox( vec2( uDepth, vVert ), vec2( 0.36, 0.10 ), vec2( 0.82, 0.85 ) );
      surfCol = mix( surfCol, floorCol * 0.52, doorMask * 0.72 );
    }
  } else if ( face == 2 ) {
    // Ceiling + bright iconic Japanese flush ceiling lamp (シーリングライト) or fluorescent strips!
    surfCol = ceilCol * ( 0.82 - 0.25 * uDepth );
    if ( isOffice > 0.5 ) {
      float gridX = smoothstep( 0.03, 0.055, abs( fract( uBack * 3.0 ) - 0.5 ) );
      float gridZ = smoothstep( 0.03, 0.055, abs( fract( uDepth * 3.0 ) - 0.5 ) );
      surfCol *= 0.82 + 0.18 * ( gridX * gridZ );
      float strip1 = imBox( vec2( uBack, uDepth ), vec2( 0.18, 0.18 ), vec2( 0.36, 0.78 ) );
      float strip2 = imBox( vec2( uBack, uDepth ), vec2( 0.64, 0.18 ), vec2( 0.82, 0.78 ) );
      fixtureBoost = max( strip1, strip2 ) * 2.4;
    } else {
      // Crisp bright circular Japanese LED ceiling light centered in room
      vec2 cd = vec2( ( uBack - 0.5 ) * max( aspect, 0.85 ), ( uDepth - 0.42 ) * 1.15 );
      float rad = length( cd );
      float disc = 1.0 - smoothstep( 0.15, 0.19, rad );
      float rim  = smoothstep( 0.17, 0.20, rad ) * ( 1.0 - smoothstep( 0.20, 0.24, rad ) );
      float halo = 1.0 - smoothstep( 0.18, 0.52, rad );
      surfCol = mix( surfCol, vec3( 0.16, 0.13, 0.10 ), rim * 0.7 );
      fixtureBoost = disc * 2.6 + halo * 0.28;
    }
  } else {
    // Floor: clearly darker horizontal plane with wood planks / tatami seams + optional rug
    float plank = 0.85 + 0.15 * sin( uBack * 34.0 );
    surfCol = floorCol * plank;
    if ( isOffice < 0.5 && r2.z > 0.38 ) {
      float rug = imBox( vec2( uBack, uDepth ), vec2( 0.20, 0.18 ), vec2( 0.80, 0.78 ) );
      surfCol = mix( surfCol, mix( backCol * 0.38, vec3( 0.32, 0.16, 0.11 ), r3.x ), rug * 0.80 );
    }
  }

  // Daytime bounce illumination (brighter near window, darker deep inside room)
  float dayBounce = mix( 0.28, 0.06, pow( uDepth, 0.85 ) ) * ( 0.62 + 0.38 * vVert ) * cornerAo;
  vec3 roomAlbedo = surfCol * dayBounce;

  // Subtle cool-blue sky/street reflection lift on unlit panes so dark windows read as glass, not voids
  if ( isLit < 0.5 ) {
    roomAlbedo += vec3( 0.025, 0.038, 0.055 ) * ( 0.35 + 0.65 * fresnel );
  }

  // Nighttime lit interior radiance — kept below ACES clip so all 5 planes retain clear contrast!
  vec3 roomEmit = vec3( 0.0 );
  if ( isLit > 0.5 ) {
    float faceGain = ( face == 0 ) ? 0.62 : ( face == 1 ? 0.52 : ( face == 2 ? 0.36 : 0.38 ) );
    roomEmit = surfCol * lightCol * ( faceGain * lampFalloff * cornerAo ) + lightCol * fixtureBoost;
  }

  // Mid-plane furniture silhouette card (3-layer parallax: window -> furniture -> room box!)
  float zMid = -rz * ( 0.34 + r3.y * 0.22 );
  float tMid = ( zMid - p.z ) / d.z;
  if ( tMid > 0.0 && tMid < t ) {
    vec2 midPos = p.xy + d.xy * tMid;
    if ( abs( midPos.x ) < rx && abs( midPos.y ) < ry ) {
      float mx = midPos.x / rx * 0.5 + 0.5;
      float my = midPos.y / ry * 0.5 + 0.5;
      float furnMask = 0.0;
      vec3 furnEmit = vec3( 0.0 );
      vec3 furnTint = vec3( 0.028, 0.022, 0.018 );

      if ( isOffice > 0.5 ) {
        float desk = imBox( vec2( mx, my ), vec2( 0.10, 0.0 ), vec2( 0.90, 0.32 ) );
        float mon1 = imBox( vec2( mx, my ), vec2( 0.20, 0.32 ), vec2( 0.44, 0.52 ) );
        float mon2 = imBox( vec2( mx, my ), vec2( 0.56, 0.32 ), vec2( 0.78, 0.50 ) );
        furnMask = max( desk, max( mon1, mon2 ) );
        furnTint = vec3( 0.03, 0.04, 0.055 );
        if ( isLit > 0.5 && r3.x > 0.40 ) {
          float scr = imBox( vec2( mx, my ), vec2( 0.22, 0.34 ), vec2( 0.42, 0.50 ) );
          furnEmit += vec3( 0.22, 0.48, 0.82 ) * scr * 0.65;
        }
      } else {
        float furnLayout = fract( r1.x * 3.17 + r2.y * 2.41 );
        if ( furnLayout < 0.36 ) {
          // Layout A: Low dining/living table + sofa + rectilinear floor lamp (no oval head-like silhouettes!)
          float table    = imBox( vec2( mx, my ), vec2( 0.16, 0.0 ), vec2( 0.70, 0.27 ) );
          float sofa     = imBox( vec2( mx, my ), vec2( 0.22, 0.24 ), vec2( 0.64, 0.42 ) );
          float lampStem = imBox( vec2( mx, my ), vec2( 0.785, 0.0 ), vec2( 0.805, 0.56 ) );
          float lampShade = imBox( vec2( mx, my ), vec2( 0.73, 0.54 ), vec2( 0.86, 0.67 ) );
          furnMask = max( max( table, sofa ), max( lampStem, lampShade ) );
          if ( isLit > 0.5 ) {
            furnEmit += lightCol * lampShade * 1.15;
          }
        } else if ( furnLayout < 0.72 ) {
          // Layout B: TV credenza + flatscreen TV (subtle cool TV glow) + tall bookcase
          float stand = imBox( vec2( mx, my ), vec2( 0.24, 0.0 ), vec2( 0.78, 0.26 ) );
          float tv    = imBox( vec2( mx, my ), vec2( 0.32, 0.26 ), vec2( 0.70, 0.52 ) );
          float shelf = imBox( vec2( mx, my ), vec2( 0.04, 0.0 ), vec2( 0.20, 0.72 ) );
          furnMask = max( max( stand, tv ), shelf );
          if ( isLit > 0.5 && r3.z < 0.62 ) {
            float screen = imBox( vec2( mx, my ), vec2( 0.34, 0.28 ), vec2( 0.68, 0.50 ) );
            furnEmit += vec3( 0.22, 0.48, 0.86 ) * screen * 0.50;
          }
        } else {
          // Layout C: Pendant dining lamp hanging from ceiling + table & chair backs
          float cord   = imBox( vec2( mx, my ), vec2( 0.490, 0.70 ), vec2( 0.510, 1.0 ) );
          float shade  = imBox( vec2( mx, my ), vec2( 0.39, 0.60 ), vec2( 0.61, 0.71 ) );
          float table  = imBox( vec2( mx, my ), vec2( 0.22, 0.0 ), vec2( 0.78, 0.30 ) );
          float chairL = imBox( vec2( mx, my ), vec2( 0.13, 0.0 ), vec2( 0.24, 0.44 ) );
          float chairR = imBox( vec2( mx, my ), vec2( 0.76, 0.0 ), vec2( 0.87, 0.44 ) );
          furnMask = max( max( cord, shade ), max( table, max( chairL, chairR ) ) );
          if ( isLit > 0.5 ) {
            float bulb = imBox( vec2( mx, my ), vec2( 0.42, 0.59 ), vec2( 0.58, 0.65 ) );
            furnEmit += lightCol * bulb * 1.65;
          }
        }
      }

      if ( furnMask > 0.01 ) {
        roomAlbedo = mix( roomAlbedo, furnTint * 0.55, furnMask * 0.92 );
        if ( isLit > 0.5 ) {
          vec3 litFurn = furnTint * lightCol * 0.35 + furnEmit;
          roomEmit = mix( roomEmit, litFurn, furnMask * 0.95 );
        }
      }
    }
  }

  // Foreground window-plane dressing: crisp pleated side curtains or upper Venetian blinds
  float fgAlpha = 0.0;
  vec3 fgAlb = vec3( 0.30, 0.29, 0.27 );
  vec3 fgEmit = vec3( 0.0 );

  if ( isOffice > 0.5 ) {
    float dropFrac = 0.22 + r2.x * 0.34;
    if ( uv.y > 1.0 - dropFrac ) {
      float slat = 0.65 + 0.35 * sin( uv.y * 150.0 );
      fgAlpha = 0.84;
      fgAlb = vec3( 0.28, 0.31, 0.35 ) * slat;
      fgEmit = lightCol * 0.22 * slat;
    }
  } else {
    // Parted side drapes with crisp vertical pleat folds & subtle curtain rail shadow at top
    float pleat = 0.70 + 0.30 * sin( uv.x * 68.0 + r1.y * 6.28 );
    float drapeL = 0.11 + r2.x * 0.14;
    float drapeR = 0.11 + r2.y * 0.14;
    float edgeMask = 1.0 - smoothstep( drapeL - 0.015, drapeL + 0.01, uv.x ) *
                           smoothstep( drapeR - 0.015, drapeR + 0.01, 1.0 - uv.x );
    if ( edgeMask > 0.01 ) {
      fgAlpha = edgeMask * ( 0.78 + 0.16 * r3.x );
      vec3 drapeTint = mix( vec3( 0.26, 0.22, 0.18 ), vec3( 0.16, 0.19, 0.23 ), r3.z );
      fgAlb = drapeTint * pleat;
      // Drapes read noticeably darker than the glowing room center so they frame the 3D interior!
      fgEmit = lightCol * mix( vec3( 0.14, 0.11, 0.08 ), vec3( 0.26, 0.22, 0.18 ), r3.y ) * pleat;
    } else if ( isLit < 0.5 && r3.y > 0.30 ) {
      // Subtle translucent white lace curtain behind unlit glass
      float sheerPleat = 0.82 + 0.18 * sin( uv.x * 84.0 );
      fgAlpha = 0.26;
      fgAlb = vec3( 0.26, 0.29, 0.32 ) * sheerPleat;
    }
  }

  roomAlbedo = mix( roomAlbedo, fgAlb, fgAlpha );
  if ( isLit > 0.5 ) {
    roomEmit = mix( roomEmit, fgEmit, fgAlpha * 0.88 );
  }

  // Soft outer jamb shadow + Fresnel glass reflection balance
  float jambVig = smoothstep( 0.0, 0.055, min( min( uv.x, 1.0 - uv.x ), min( uv.y, 1.0 - uv.y ) ) );
  float vigFactor = 0.58 + 0.42 * jambVig;
  float glassTransmit = 1.0 - 0.48 * fresnel;

  // Per-window brightness diversity
  float roomBright = 0.74 + 0.44 * r1.z;

  res.albedo = roomAlbedo * vigFactor * glassTransmit;
  res.emission = roomEmit * vigFactor * glassTransmit * roomBright;
  return res;
}
`;
}

/**
 * Enhances a Three.js MeshStandardMaterial with single-quad 3D parallax Interior Mapping.
 * Preserves PBR specular/PMREM reflections and dynamic `emissiveIntensity` updates from atmosphere.js.
 *
 * @param {import('three').MeshStandardMaterial} material
 * @param {'living_warm'|'modern_led'|'office_cool'|'amber_shoji'|'unlit_curtain'|'unlit_blinds'} variant
 */
export function applyInteriorMapping(material, variant = 'living_warm') {
  const modeId = VARIANT_MODES[variant] ?? 0;

  material.customProgramCacheKey = () => `interior-mapping-v2-${variant}`;
  material.onBeforeCompile = (shader) => {
    // 1. Vertex shader: forward world position, world normal, and raw integer-offset UV0
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vImWorldPos;
varying vec3 vImWorldNormal;
varying vec2 vImUv;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 imWp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    imWp = instanceMatrix * imWp;
  #endif
  imWp = modelMatrix * imWp;
  vImWorldPos = imWp.xyz;
  mat3 imNm = mat3( modelMatrix );
  #ifdef USE_INSTANCING
    imNm = imNm * mat3( instanceMatrix );
  #endif
  vImWorldNormal = normalize( imNm * objectNormal );
  vImUv = uv;
}`,
      );

    // 2. Fragment shader: evaluate 3D parallax room in place of static 2D map & emissiveMap
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${buildInteriorFragmentHelpers(modeId)}`,
      )
      .replace(
        '#include <map_fragment>',
        `ImResult imRes = imEvaluateRoom( vImWorldPos, vImWorldNormal, vImUv );
diffuseColor.rgb = imRes.albedo;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `totalEmissiveRadiance = imRes.emission * emissive;`,
      );
  };

  material.needsUpdate = true;
  return material;
}

// ------------------------------------------------------------------ 1F COMMERCIAL STOREFRONTS

const SHOP_MODES = {
  kissaten: 0,
  bookstore: 1,
  konbini: 2,
  pharmacy: 3,
  izakaya: 4,
  ramen: 5,
};

function buildShopFragmentHelpers(shopModeId) {
  return /* glsl */ `
varying vec3 vImWorldPos;
varying vec3 vImWorldNormal;
varying vec2 vImUv;

const int IM_SHOP_MODE = ${shopModeId};

float imShopHash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

vec3 imShopHash31( float p ) {
  vec3 p3 = fract( vec3( p ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.xxy + p3.yzz ) * p3.zyx );
}

float imShopBox( vec2 p, vec2 lo, vec2 hi ) {
  vec2 s = step( lo, p ) * step( p, hi );
  return s.x * s.y;
}

struct ImShopResult {
  vec3 albedo;
  vec3 emission;
};

// Colorful procedural retail shelf / bookspine rows on a wall or gondola
vec3 imShelfGoods( vec2 q, float seed, float isBooks ) {
  float cols = isBooks > 0.5 ? 26.0 : 14.0;
  float rows = isBooks > 0.5 ? 6.0 : 4.0;
  vec2 cell = floor( vec2( q.x * cols, q.y * rows ) );
  vec2 f = fract( vec2( q.x * cols, q.y * rows ) );
  float shelfPlank = step( f.y, 0.14 );
  float itemH = 0.58 + 0.34 * imShopHash12( cell + vec2( seed, 3.1 ) );
  float itemGap = step( 0.09, f.x ) * step( f.x, 0.91 ) * step( 0.14, f.y ) * step( f.y, itemH );
  vec3 rnd = imShopHash31( cell.x * 13.7 + cell.y * 57.3 + seed * 19.1 );

  vec3 goodCol;
  if ( isBooks > 0.5 ) {
    // Rich vintage book spines (burgundy, navy, ochre, forest, cream)
    if ( rnd.x < 0.22 ) goodCol = vec3( 0.42, 0.10, 0.08 );
    else if ( rnd.x < 0.44 ) goodCol = vec3( 0.10, 0.18, 0.34 );
    else if ( rnd.x < 0.66 ) goodCol = vec3( 0.52, 0.36, 0.14 );
    else if ( rnd.x < 0.84 ) goodCol = vec3( 0.12, 0.28, 0.18 );
    else goodCol = vec3( 0.68, 0.62, 0.50 );
  } else {
    // Bright Japanese konbini/pharmacy product packs
    if ( rnd.x < 0.20 ) goodCol = vec3( 0.78, 0.16, 0.12 );
    else if ( rnd.x < 0.40 ) goodCol = vec3( 0.85, 0.62, 0.14 );
    else if ( rnd.x < 0.60 ) goodCol = vec3( 0.14, 0.54, 0.28 );
    else if ( rnd.x < 0.80 ) goodCol = vec3( 0.16, 0.40, 0.76 );
    else goodCol = vec3( 0.82, 0.80, 0.76 );
  }

  vec3 backDark = isBooks > 0.5 ? vec3( 0.08, 0.05, 0.03 ) : vec3( 0.18, 0.20, 0.22 );
  vec3 plankCol = isBooks > 0.5 ? vec3( 0.22, 0.13, 0.06 ) : vec3( 0.45, 0.48, 0.52 );
  vec3 col = mix( backDark, goodCol, itemGap );
  return mix( col, plankCol, shelfPlank );
}

ImShopResult imEvaluateShop( vec3 worldPos, vec3 worldNormal, vec2 rawUv ) {
  ImShopResult res;
  res.albedo = vec3( 0.04 );
  res.emission = vec3( 0.0 );

  vec3 N = normalize( worldNormal );
  if ( abs( N.y ) > 0.92 ) {
    return res;
  }

  vec2 bayUv = fract( rawUv );
  vec3 B = vec3( 0.0, 1.0, 0.0 );
  vec3 T = normalize( cross( B, N ) );

  // Stable per-shop / per-bay random seed from quantized bay center in world XZ
  vec2 bayCenterXZ = worldPos.xz - T.xz * ( bayUv.x - 0.5 ) * 3.1;
  vec2 shopCell = floor( bayCenterXZ * 0.42 + 0.5 );
  float seed = imShopHash12( shopCell + vec2( 7.1, 29.3 ) ) * 91.0;
  vec3 r1 = imShopHash31( seed + 2.3 );
  vec3 r2 = imShopHash31( seed + 17.9 );
  vec3 r3 = imShopHash31( seed + 43.7 );

  vec3 rayWorld = normalize( worldPos - cameraPosition );
  float ndotv = clamp( dot( N, -rayWorld ), 0.0, 1.0 );
  float fresnel = pow( 1.0 - ndotv, 4.0 );
  vec3 d = vec3( dot( rayWorld, T ), dot( rayWorld, B ), min( dot( rayWorld, N ), -0.002 ) );

  // Storefront bay aspect (~3.1 m wide x 2.8 m tall -> 1.12) & deep commercial room box
  float aspect = 1.12;
  float rx = 0.62 + r1.x * 0.08;
  float ry = 0.54;
  float rz = ( IM_SHOP_MODE == 2 || IM_SHOP_MODE == 3 ) ? ( 2.05 + r1.z * 0.55 ) : ( 1.55 + r1.z * 0.55 );

  vec3 p = vec3( ( bayUv.x - 0.5 ) * aspect, bayUv.y - 0.5, 0.0 );

  // Analytic ray-box intersection with the 5 interior shop surfaces
  float tx = ( abs( d.x ) > 1e-4 ) ? ( ( d.x > 0.0 ? rx : -rx ) - p.x ) / d.x : 1e6;
  float ty = ( abs( d.y ) > 1e-4 ) ? ( ( d.y > 0.0 ? ry : -ry ) - p.y ) / d.y : 1e6;
  float tz = ( -rz - p.z ) / d.z;

  float t = min( tz, min( tx, ty ) );
  vec3 hit = p + d * t;

  int face = 0;
  if ( t == tx ) {
    face = 1;
  } else if ( t == ty ) {
    face = ( d.y > 0.0 ) ? 2 : 3;
  }

  float uBack = clamp( hit.x / rx * 0.5 + 0.5, 0.0, 1.0 );
  float vVert = clamp( hit.y / ry * 0.5 + 0.5, 0.0, 1.0 );
  float uDepth = clamp( -hit.z / rz, 0.0, 1.0 );

  // Corner & edge ambient occlusion for clear architectural box readability
  float aoX = smoothstep( 0.0, 0.14, 1.0 - abs( hit.x ) / rx );
  float aoY = smoothstep( 0.0, 0.14, 1.0 - abs( hit.y ) / ry );
  float aoZ = smoothstep( 0.0, 0.15, 1.0 - uDepth );
  float cornerAo = 0.30 + 0.70 * (
    ( face == 0 ) ? ( aoX * aoY ) :
    ( face == 1 ) ? ( aoY * aoZ ) :
                    ( aoX * aoZ )
  );

  // Depth falloff inside the shop
  float depthShade = mix( 1.05, 0.52, uDepth * 0.85 );

  vec3 surfCol = vec3( 0.5 );
  vec3 lightCol = vec3( 1.0, 0.72, 0.36 );
  float fixtureBoost = 0.0;
  vec3 extraGlow = vec3( 0.0 );

  if ( IM_SHOP_MODE == 0 ) {
    // 0: KISSATEN (純喫茶 — Showa retro coffee house: dark wood, warm ochre walls, espresso bar, checkered floor)
    lightCol = mix( vec3( 1.00, 0.62, 0.24 ), vec3( 1.00, 0.72, 0.36 ), r2.x );
    if ( face == 0 ) {
      // Back wall: dark walnut bar counter + illuminated coffee/bottle backbar shelves
      vec3 plaster = vec3( 0.66, 0.48, 0.28 );
      vec3 wood = vec3( 0.16, 0.08, 0.035 );
      float counter = step( vVert, 0.36 );
      float counterTop = imShopBox( vec2( uBack, vVert ), vec2( 0.0, 0.35 ), vec2( 1.0, 0.39 ) );
      float shelfArea = imShopBox( vec2( uBack, vVert ), vec2( 0.12, 0.44 ), vec2( 0.88, 0.84 ) );
      surfCol = mix( plaster, wood, counter );
      surfCol = mix( surfCol, vec3( 0.38, 0.22, 0.10 ), counterTop );
      if ( shelfArea > 0.5 ) {
        vec3 cups = imShelfGoods( vec2( ( uBack - 0.12 ) / 0.76, ( vVert - 0.44 ) / 0.40 ), seed + 5.0, 1.0 );
        surfCol = mix( surfCol, cups * 1.15, 0.92 );
        extraGlow += vec3( 0.45, 0.26, 0.09 ) * 0.35;
      }
      // Espresso machine / siphon silhouette sitting on the back counter
      float mach = imShopBox( vec2( uBack, vVert ), vec2( 0.22, 0.38 ), vec2( 0.42, 0.53 ) );
      surfCol = mix( surfCol, vec3( 0.28, 0.26, 0.24 ), mach );
    } else if ( face == 1 ) {
      // Side walls: dark timber wainscoting + vintage cream plaster + framed jazz/coffee poster
      float wainscot = step( vVert, 0.38 );
      float rail = imShopBox( vec2( uDepth, vVert ), vec2( 0.0, 0.37 ), vec2( 1.0, 0.40 ) );
      surfCol = mix( vec3( 0.42, 0.31, 0.20 ), vec3( 0.13, 0.07, 0.03 ), wainscot );
      surfCol = mix( surfCol, vec3( 0.28, 0.16, 0.08 ), rail );
      float poster = imShopBox( vec2( uDepth, vVert ), vec2( 0.28, 0.52 ), vec2( 0.66, 0.78 ) );
      surfCol = mix( surfCol, vec3( 0.20, 0.14, 0.09 ), poster * 0.75 );
      // Warm brass wall sconce bracket + soft wall wash halfway down side wall
      vec2 sc = vec2( ( uDepth - 0.50 ) * 1.4, vVert - 0.68 );
      float sconceBase = imShopBox( vec2( uDepth, vVert ), vec2( 0.485, 0.62 ), vec2( 0.515, 0.68 ) );
      surfCol = mix( surfCol, vec3( 0.10, 0.07, 0.04 ), sconceBase );
      fixtureBoost += ( 1.0 - smoothstep( 0.02, 0.22, length( sc ) ) ) * 0.42;
    } else if ( face == 2 ) {
      // Dark timber-beamed ceiling with gentle warm bounce pools (pendant globes are the hero fixtures)
      float beam = step( 0.86, fract( uDepth * 4.0 ) );
      surfCol = mix( vec3( 0.24, 0.16, 0.09 ), vec3( 0.10, 0.06, 0.03 ), beam );
      vec2 l1 = vec2( ( uBack - 0.34 ) * 1.2, uDepth - 0.38 );
      vec2 l2 = vec2( ( uBack - 0.66 ) * 1.2, uDepth - 0.38 );
      vec2 l3 = vec2( ( uBack - 0.50 ) * 1.2, uDepth - 0.74 );
      float glow = max( max( 1.0 - smoothstep( 0.06, 0.24, length( l1 ) ),
                             1.0 - smoothstep( 0.06, 0.24, length( l2 ) ) ),
                             1.0 - smoothstep( 0.08, 0.26, length( l3 ) ) );
      fixtureBoost = glow * 0.75;
    } else {
      // Classic Showa dark walnut / subtle checkered café tile floor
      float chk = mod( floor( uBack * 8.0 ) + floor( uDepth * 10.0 ), 2.0 );
      surfCol = mix( vec3( 0.12, 0.07, 0.04 ), vec3( 0.24, 0.16, 0.10 ), chk );
    }
  } else if ( IM_SHOP_MODE == 1 ) {
    // 1: BOOKSTORE (古書・文具 — towering floor-to-ceiling colorful wood bookshelves!)
    lightCol = mix( vec3( 1.00, 0.78, 0.46 ), vec3( 1.00, 0.86, 0.62 ), r2.x );
    if ( face == 0 || face == 1 ) {
      float uWall = ( face == 0 ) ? uBack : uDepth;
      float shelfRegion = step( 0.08, vVert ) * step( vVert, 0.90 );
      vec3 books = imShelfGoods( vec2( uWall, ( vVert - 0.08 ) / 0.82 ), seed + float( face ) * 11.0, 1.0 );
      surfCol = mix( vec3( 0.18, 0.11, 0.06 ), books, shelfRegion );
      if ( face == 1 ) surfCol *= 0.72;
    } else if ( face == 2 ) {
      surfCol = vec3( 0.42, 0.38, 0.32 );
      float tube1 = imShopBox( vec2( uBack, uDepth ), vec2( 0.20, 0.14 ), vec2( 0.32, 0.86 ) );
      float tube2 = imShopBox( vec2( uBack, uDepth ), vec2( 0.68, 0.14 ), vec2( 0.80, 0.86 ) );
      fixtureBoost = max( tube1, tube2 ) * 2.1;
    } else {
      float plank = 0.86 + 0.14 * sin( uBack * 32.0 );
      surfCol = vec3( 0.24, 0.15, 0.08 ) * plank;
    }
  } else if ( IM_SHOP_MODE == 2 ) {
    // 2: KONBINI (コンビニ — bright LED tube ceiling rows + glowing cool-blue back drink cooler + colorful shelves!)
    lightCol = vec3( 0.95, 0.98, 1.00 );
    if ( face == 0 ) {
      // Back wall: iconic illuminated cold beverage glass-door cooler wall!
      float cooler = imShopBox( vec2( uBack, vVert ), vec2( 0.06, 0.10 ), vec2( 0.94, 0.84 ) );
      vec3 drinks = imShelfGoods( vec2( ( uBack - 0.06 ) / 0.88, ( vVert - 0.10 ) / 0.74 ), seed + 3.0, 0.0 );
      float doorFrame = step( 0.92, fract( uBack * 5.0 ) );
      vec3 coolerCol = mix( drinks, vec3( 0.16, 0.20, 0.24 ), doorFrame );
      surfCol = mix( vec3( 0.72, 0.76, 0.80 ), coolerCol, cooler );
      extraGlow += vec3( 0.32, 0.56, 0.78 ) * cooler * ( 1.0 - doorFrame ) * 0.65;
    } else if ( face == 1 ) {
      float shelf = imShopBox( vec2( uDepth, vVert ), vec2( 0.08, 0.08 ), vec2( 0.92, 0.76 ) );
      vec3 goods = imShelfGoods( vec2( uDepth, vVert / 0.76 ), seed + 19.0, 0.0 );
      float header = imShopBox( vec2( uDepth, vVert ), vec2( 0.0, 0.76 ), vec2( 1.0, 0.86 ) );
      surfCol = mix( vec3( 0.56, 0.58, 0.60 ), goods * 0.78, shelf );
      surfCol = mix( surfCol, r2.y < 0.5 ? vec3( 0.10, 0.42, 0.78 ) : vec3( 0.12, 0.56, 0.34 ), header );
    } else if ( face == 2 ) {
      // Iconic parallel bright white LED ceiling tube strips receding into store!
      surfCol = vec3( 0.54, 0.58, 0.62 );
      float s1 = imShopBox( vec2( uBack, uDepth ), vec2( 0.16, 0.06 ), vec2( 0.26, 0.92 ) );
      float s2 = imShopBox( vec2( uBack, uDepth ), vec2( 0.45, 0.06 ), vec2( 0.55, 0.92 ) );
      float s3 = imShopBox( vec2( uBack, uDepth ), vec2( 0.74, 0.06 ), vec2( 0.84, 0.92 ) );
      fixtureBoost = max( s1, max( s2, s3 ) ) * 2.55;
    } else {
      // Glossy bright convenience-store floor tiles
      float tile = 0.92 + 0.08 * step( 0.06, fract( uBack * 6.0 ) ) * step( 0.06, fract( uDepth * 8.0 ) );
      surfCol = vec3( 0.46, 0.45, 0.42 ) * tile;
    }
  } else if ( IM_SHOP_MODE == 3 ) {
    // 3: PHARMACY (薬局 — crisp clinical white interior, green pharmacy header, dispensing counter)
    lightCol = vec3( 0.86, 0.96, 1.00 );
    if ( face == 0 ) {
      float counter = step( vVert, 0.36 );
      float header = imShopBox( vec2( uBack, vVert ), vec2( 0.0, 0.82 ), vec2( 1.0, 0.92 ) );
      float shelves = imShopBox( vec2( uBack, vVert ), vec2( 0.08, 0.38 ), vec2( 0.92, 0.80 ) );
      vec3 boxes = imShelfGoods( vec2( uBack, ( vVert - 0.38 ) / 0.42 ), seed + 9.0, 0.0 );
      surfCol = mix( vec3( 0.68, 0.74, 0.74 ), vec3( 0.82, 0.85, 0.84 ), counter );
      surfCol = mix( surfCol, mix( vec3( 0.78, 0.82, 0.82 ), boxes, 0.65 ), shelves );
      surfCol = mix( surfCol, vec3( 0.10, 0.46, 0.34 ), header );
    } else if ( face == 1 ) {
      float shelves = imShopBox( vec2( uDepth, vVert ), vec2( 0.10, 0.08 ), vec2( 0.90, 0.78 ) );
      vec3 boxes = imShelfGoods( vec2( uDepth, vVert / 0.78 ), seed + 23.0, 0.0 );
      surfCol = mix( vec3( 0.48, 0.54, 0.56 ), mix( vec3( 0.64, 0.68, 0.68 ), boxes, 0.55 ) * 0.76, shelves );
    } else if ( face == 2 ) {
      surfCol = vec3( 0.50, 0.56, 0.58 );
      float p1 = imShopBox( vec2( uBack, uDepth ), vec2( 0.22, 0.18 ), vec2( 0.78, 0.36 ) );
      float p2 = imShopBox( vec2( uBack, uDepth ), vec2( 0.22, 0.56 ), vec2( 0.78, 0.74 ) );
      fixtureBoost = max( p1, p2 ) * 2.3;
    } else {
      surfCol = vec3( 0.40, 0.44, 0.45 );
    }
  } else {
    // 4 & 5: IZAKAYA / RAMEN (居酒屋・中華そば — seen through wooden lattice! Warm amber counter, tanzaku menu plaques, lantern glow)
    lightCol = ( IM_SHOP_MODE == 4 ) ? vec3( 1.00, 0.58, 0.20 ) : vec3( 1.00, 0.66, 0.26 );
    if ( face == 0 ) {
      // Wooden L-counter + upper row of cream hanging wooden menu plaques (短冊メニュー)!
      float counter = step( vVert, 0.38 );
      float plaques = imShopBox( vec2( uBack, vVert ), vec2( 0.08, 0.66 ), vec2( 0.92, 0.88 ) );
      float plaqueSlit = step( 0.16, fract( uBack * 12.0 ) );
      vec3 plaster = vec3( 0.58, 0.42, 0.24 );
      vec3 wood = vec3( 0.24, 0.12, 0.05 );
      surfCol = mix( plaster, wood, counter );
      surfCol = mix( surfCol, vec3( 0.86, 0.74, 0.52 ), plaques * plaqueSlit );
      // Sake bottles / bowls along counter back
      float shelf = imShopBox( vec2( uBack, vVert ), vec2( 0.14, 0.40 ), vec2( 0.86, 0.60 ) );
      vec3 bottles = imShelfGoods( vec2( uBack, ( vVert - 0.40 ) / 0.20 ), seed + 15.0, 1.0 );
      surfCol = mix( surfCol, bottles, shelf * 0.85 );
    } else if ( face == 1 ) {
      float wood = step( vVert, 0.45 );
      surfCol = mix( vec3( 0.40, 0.28, 0.16 ), vec3( 0.16, 0.08, 0.035 ), wood );
      float poster = imShopBox( vec2( uDepth, vVert ), vec2( 0.30, 0.55 ), vec2( 0.70, 0.82 ) );
      surfCol = mix( surfCol, vec3( 0.78, 0.66, 0.48 ), poster * 0.8 );
    } else if ( face == 2 ) {
      // Dark timber beams + warm hanging bulb glows
      float beam = step( 0.82, fract( uDepth * 4.5 ) );
      surfCol = mix( vec3( 0.20, 0.12, 0.06 ), vec3( 0.08, 0.04, 0.02 ), beam );
      vec2 b1 = vec2( ( uBack - 0.35 ) * 1.2, uDepth - 0.35 );
      vec2 b2 = vec2( ( uBack - 0.65 ) * 1.2, uDepth - 0.65 );
      float glow = max( 1.0 - smoothstep( 0.06, 0.18, length( b1 ) ),
                        1.0 - smoothstep( 0.06, 0.18, length( b2 ) ) );
      fixtureBoost = glow * 2.1;
    } else {
      surfCol = vec3( 0.12, 0.08, 0.05 );
    }
  }

  float dayBounce = mix( 0.30, 0.07, pow( uDepth, 0.85 ) ) * ( 0.65 + 0.35 * vVert ) * cornerAo;
  vec3 shopAlbedo = surfCol * dayBounce;
  float faceGain = ( face == 0 ) ? 0.74 : ( face == 1 ? 0.56 : ( face == 2 ? 0.42 : 0.44 ) );
  vec3 shopEmit = surfCol * lightCol * ( faceGain * depthShade * cornerAo ) + lightCol * fixtureBoost + extraGlow;

  // Mid-plane interior props (3-layer depth parallax: outer mullions -> café tables/gondolas/pendants -> back wall!)
  float zMid = -rz * ( 0.34 + r3.y * 0.14 );
  float tMid = ( zMid - p.z ) / d.z;
  if ( tMid > 0.0 && tMid < t ) {
    vec2 mp = p.xy + d.xy * tMid;
    if ( abs( mp.x ) < rx && abs( mp.y ) < ry ) {
      float mx = mp.x / rx * 0.5 + 0.5;
      float my = mp.y / ry * 0.5 + 0.5;
      float propMask = 0.0;
      vec3 propCol = vec3( 0.04, 0.03, 0.025 );
      vec3 propEmit = vec3( 0.0 );

      if ( IM_SHOP_MODE == 0 ) {
        // Kissaten: two glowing glass globe pendant lamps pulled cleanly inward + dark café booth tables & chairs
        float cordL = imShopBox( vec2( mx, my ), vec2( 0.335, 0.72 ), vec2( 0.347, 1.0 ) );
        float cordR = imShopBox( vec2( mx, my ), vec2( 0.653, 0.72 ), vec2( 0.665, 1.0 ) );
        float globeL = 1.0 - smoothstep( 0.045, 0.058, length( vec2( mx - 0.34, ( my - 0.69 ) * 0.92 ) ) );
        float globeR = 1.0 - smoothstep( 0.045, 0.058, length( vec2( mx - 0.66, ( my - 0.69 ) * 0.92 ) ) );
        float tbl1 = imShopBox( vec2( mx, my ), vec2( 0.16, 0.0 ), vec2( 0.46, 0.28 ) );
        float tbl2 = imShopBox( vec2( mx, my ), vec2( 0.54, 0.0 ), vec2( 0.84, 0.28 ) );
        float ch1  = imShopBox( vec2( mx, my ), vec2( 0.10, 0.0 ), vec2( 0.18, 0.40 ) );
        float ch2  = imShopBox( vec2( mx, my ), vec2( 0.45, 0.0 ), vec2( 0.53, 0.40 ) );
        propMask = max( max( max( cordL, cordR ), max( globeL, globeR ) ), max( max( tbl1, tbl2 ), max( ch1, ch2 ) ) );
        propEmit += vec3( 1.0, 0.82, 0.48 ) * max( globeL, globeR ) * 2.35;
      } else if ( IM_SHOP_MODE == 1 ) {
        // Bookstore: central wooden flat-display book table + two warm pendant shades
        float table = imShopBox( vec2( mx, my ), vec2( 0.18, 0.0 ), vec2( 0.82, 0.32 ) );
        float stack = imShopBox( vec2( mx, my ), vec2( 0.22, 0.32 ), vec2( 0.78, 0.39 ) );
        float cord  = imShopBox( vec2( mx, my ), vec2( 0.493, 0.74 ), vec2( 0.507, 1.0 ) );
        float shade = imShopBox( vec2( mx, my ), vec2( 0.41, 0.67 ), vec2( 0.59, 0.75 ) );
        propMask = max( max( table, stack ), max( cord, shade ) );
        propCol = mix( vec3( 0.08, 0.05, 0.03 ), vec3( 0.46, 0.34, 0.20 ), stack );
        propEmit += lightCol * imShopBox( vec2( mx, my ), vec2( 0.43, 0.65 ), vec2( 0.57, 0.69 ) ) * 1.8;
      } else if ( IM_SHOP_MODE == 2 || IM_SHOP_MODE == 3 ) {
        // Konbini / Pharmacy: colorful mid-aisle product gondola racks!
        float rackL = imShopBox( vec2( mx, my ), vec2( 0.08, 0.0 ), vec2( 0.44, 0.46 ) );
        float rackR = imShopBox( vec2( mx, my ), vec2( 0.56, 0.0 ), vec2( 0.92, 0.46 ) );
        propMask = max( rackL, rackR );
        if ( propMask > 0.5 ) {
          vec3 goods = imShelfGoods( vec2( mx * 1.4, my / 0.46 ), seed + 31.0, 0.0 );
          propCol = goods * 0.32;
          propEmit = goods * lightCol * 0.45;
        }
      } else {
        // Izakaya / Ramen: counter edge + wooden stools + glowing hanging warm mini-lanterns!
        float stools = imShopBox( vec2( mx, my ), vec2( 0.16, 0.0 ), vec2( 0.26, 0.32 ) ) +
                       imShopBox( vec2( mx, my ), vec2( 0.44, 0.0 ), vec2( 0.54, 0.32 ) ) +
                       imShopBox( vec2( mx, my ), vec2( 0.72, 0.0 ), vec2( 0.82, 0.32 ) );
        float cordL = imShopBox( vec2( mx, my ), vec2( 0.335, 0.76 ), vec2( 0.348, 1.0 ) );
        float cordR = imShopBox( vec2( mx, my ), vec2( 0.655, 0.76 ), vec2( 0.668, 1.0 ) );
        float lantL = imShopBox( vec2( mx, my ), vec2( 0.29, 0.62 ), vec2( 0.39, 0.77 ) );
        float lantR = imShopBox( vec2( mx, my ), vec2( 0.61, 0.62 ), vec2( 0.71, 0.77 ) );
        propMask = clamp( max( stools, max( max( cordL, cordR ), max( lantL, lantR ) ) ), 0.0, 1.0 );
        propEmit += vec3( 1.0, 0.56, 0.18 ) * max( lantL, lantR ) * 1.95;
      }

      if ( propMask > 0.01 ) {
        shopAlbedo = mix( shopAlbedo, propCol, propMask * 0.92 );
        shopEmit = mix( shopEmit, propCol * lightCol * 0.35 + propEmit, propMask * 0.94 );
      }
    }
  }

  float glassTransmit = 1.0 - 0.46 * fresnel;
  float shopBright = 0.84 + 0.28 * r1.y;
  res.albedo = shopAlbedo * glassTransmit;
  res.emission = shopEmit * glassTransmit * shopBright;
  return res;
}
`;
}

/**
 * Enhances a ground-floor commercial storefront MeshStandardMaterial with masked 3D parallax Interior Mapping.
 * Uses the storefront's existing `emissiveMap` as a pixel-exact mask so frames, mullions, wood wainscoting,
 * and izakaya wooden lattice stay crisp opaque matte geometry while ONLY glass panes show deep 3D interiors
 * with glossy storefront reflections.
 *
 * @param {import('three').MeshStandardMaterial} material
 * @param {'kissaten'|'bookstore'|'konbini'|'pharmacy'|'izakaya'|'ramen'} variant
 */
export function applyShopInteriorMapping(material, variant = 'kissaten') {
  const modeId = SHOP_MODES[variant] ?? 0;

  material.customProgramCacheKey = () => `shop-interior-mapping-v1-${variant}`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vImWorldPos;
varying vec3 vImWorldNormal;
varying vec2 vImUv;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 imWp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    imWp = instanceMatrix * imWp;
  #endif
  imWp = modelMatrix * imWp;
  vImWorldPos = imWp.xyz;
  mat3 imNm = mat3( modelMatrix );
  #ifdef USE_INSTANCING
    imNm = imNm * mat3( instanceMatrix );
  #endif
  vImWorldNormal = normalize( imNm * objectNormal );
  vImUv = uv;
}`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${buildShopFragmentHelpers(modeId)}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float imShopMask = 0.0;
ImShopResult imShopRes;
imShopRes.albedo = vec3( 0.0 );
imShopRes.emission = vec3( 0.0 );
#ifdef USE_EMISSIVEMAP
  vec3 imMaskSample = texture2D( emissiveMap, vEmissiveMapUv ).rgb;
  imShopMask = smoothstep( 0.03, 0.11, max( imMaskSample.r, max( imMaskSample.g, imMaskSample.b ) ) );
  if ( imShopMask > 0.005 ) {
    imShopRes = imEvaluateShop( vImWorldPos, vImWorldNormal, vImUv );
    diffuseColor.rgb = mix( diffuseColor.rgb, imShopRes.albedo, imShopMask );
  }
#endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, 0.06, imShopMask );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `totalEmissiveRadiance = imShopRes.emission * emissive * imShopMask;`,
      );
  };

  material.needsUpdate = true;
  return material;
}

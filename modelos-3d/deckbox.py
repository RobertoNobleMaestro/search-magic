"""Genera una caja para un mazo de Magic (base + tapa) en STL, sin dependencias.

Uso:  python deckbox.py            -> deckbox_base.stl y deckbox_tapa.stl
Cambia los parámetros de abajo para otros tamaños (medidas en mm).
"""
import base64
import json
import struct
from pathlib import Path

# --- Parámetros -------------------------------------------------------------
CARTA_ANCHO = 67.0    # carta con funda (Dragon Shield ~66x91, doble funda ~67x92)
CARTA_ALTO = 92.0
GROSOR_MAZO = 80.0    # 100 cartas enfundadas (~70 mm) + tokens/dados
HOLGURA_CARTAS = 1.0  # aire a cada lado de las cartas
PARED = 2.0
SUELO = 2.0
HOLGURA_TAPA = 0.25   # por lado; sube a 0.3-0.4 si la tapa entra muy dura
ASOMAN = 30.0         # mm de carta que sobresalen de la base para cogerlas
DEDO_ANCHO = 30.0     # muesca en los laterales largos de la base
DEDO_FONDO = 15.0

# Coste: PLA básico (negro/blanco/gris suelen ser los más baratos de cada marca)
DENSIDAD_PLA = 1.24   # g/cm3
PRECIO_KG = 18.0      # €/kg aproximado de una bobina de PLA básico


def caja_abierta(ancho, fondo, alto, pared, suelo, muesca=None):
    """Caja abierta por arriba como (sólidos, huecos), cada uno (x0,y0,z0,x1,y1,z1)."""
    solidos = [(0, 0, 0, ancho, fondo, alto)]
    huecos = [(pared, pared, suelo, ancho - pared, fondo - pared, alto + 1)]
    if muesca:
        w, h = muesca
        cx = ancho / 2
        huecos.append((cx - w / 2, -1, alto - h, cx + w / 2, fondo + 1, alto + 1))
    return solidos, huecos


def malla(solidos, huecos):
    """Triangula unión(sólidos) - unión(huecos) sobre una rejilla común (estanca)."""
    cortes = [sorted({c[i] for c in solidos + huecos} | {c[i + 3] for c in solidos + huecos})
              for i in range(3)]

    def dentro(p, cajas):
        return any(all(c[i] < p[i] < c[i + 3] for i in range(3)) for c in cajas)

    n = [len(c) - 1 for c in cortes]
    lleno = {}
    for i in range(n[0]):
        for j in range(n[1]):
            for k in range(n[2]):
                centro = [(cortes[a][idx] + cortes[a][idx + 1]) / 2
                          for a, idx in zip(range(3), (i, j, k))]
                lleno[(i, j, k)] = dentro(centro, solidos) and not dentro(centro, huecos)

    tris = []
    for celda, ok in lleno.items():
        if not ok:
            continue
        for a in range(3):
            b, c = (a + 1) % 3, (a + 2) % 3
            for s in (1, -1):
                vecino = list(celda)
                vecino[a] += s
                if lleno.get(tuple(vecino), False):
                    continue
                pa = cortes[a][celda[a] + (1 if s == 1 else 0)]
                b0, b1 = cortes[b][celda[b]], cortes[b][celda[b] + 1]
                c0, c1 = cortes[c][celda[c]], cortes[c][celda[c] + 1]
                quad = [(b0, c0), (b1, c0), (b1, c1), (b0, c1)]
                if s == -1:
                    quad.reverse()
                pts = []
                for vb, vc in quad:
                    p = [0.0, 0.0, 0.0]
                    p[a], p[b], p[c] = pa, vb, vc
                    pts.append(tuple(p))
                normal = [0.0, 0.0, 0.0]
                normal[a] = float(s)
                tris.append((normal, pts[0], pts[1], pts[2]))
                tris.append((normal, pts[0], pts[2], pts[3]))
    return tris


def volumen_cm3(tris):
    v = 0.0
    for _, a, b, c in tris:
        v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
              + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    return v / 1000


def guardar_stl(ruta, tris, nombre):
    with open(ruta, "wb") as f:
        f.write(nombre.encode().ljust(80, b" ")[:80])
        f.write(struct.pack("<I", len(tris)))
        for normal, *vs in tris:
            f.write(struct.pack("<3f", *normal))
            for v in vs:
                f.write(struct.pack("<3f", *v))
            f.write(b"\0\0")


def main():
    hueco_x = CARTA_ANCHO + 2 * HOLGURA_CARTAS
    hueco_y = GROSOR_MAZO
    base_x, base_y = hueco_x + 2 * PARED, hueco_y + 2 * PARED
    base_z = SUELO + CARTA_ALTO - ASOMAN

    # Base: muesca en las paredes de fondo (las que miran a la cara de las cartas)
    base = caja_abierta(base_x, base_y, base_z, PARED, SUELO, muesca=(DEDO_ANCHO, DEDO_FONDO))

    # Tapa: se imprime boca arriba (techo sobre la cama) y cubre toda la base
    tapa_hx, tapa_hy = base_x + 2 * HOLGURA_TAPA, base_y + 2 * HOLGURA_TAPA
    tapa_alto_util = SUELO + CARTA_ALTO + HOLGURA_CARTAS
    tapa = caja_abierta(tapa_hx + 2 * PARED, tapa_hy + 2 * PARED,
                        tapa_alto_util + SUELO, PARED, SUELO)

    out = Path(__file__).parent
    piezas = {}
    for nombre, (sol, hue) in (("deckbox_base", base), ("deckbox_tapa", tapa)):
        tris = malla(sol, hue)
        guardar_stl(out / f"{nombre}.stl", tris, nombre)
        x1 = max(c[3] for c in sol); y1 = max(c[4] for c in sol); z1 = max(c[5] for c in sol)
        gramos = volumen_cm3(tris) * DENSIDAD_PLA
        piezas[nombre] = {"stl": base64.b64encode((out / f"{nombre}.stl").read_bytes()).decode(),
                          "dims": [x1, y1, z1], "gramos": gramos}
        print(f"{nombre}.stl  {x1:.1f} x {y1:.1f} x {z1:.1f} mm  ~{gramos:.0f} g  "
              f"({len(tris)} triángulos)")

    total = sum(p["gramos"] for p in piezas.values())
    print(f"Total ~{total:.0f} g de PLA -> ~{total / 1000 * PRECIO_KG:.2f} € a {PRECIO_KG:.0f} €/kg")

    # Vista previa: los STL van incrustados para que funcione abriendo el archivo
    datos = {"piezas": piezas, "offset": PARED + HOLGURA_TAPA, "precioKg": PRECIO_KG}
    html = PREVIEW_HTML.replace("__DATOS__", json.dumps(datos))
    (out / "preview.html").write_text(html, encoding="utf-8")
    print("preview.html")


PREVIEW_HTML = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deck box preview</title>
<style>
  :root { --bg:#f4f4f2; --panel:#ffffff; --text:#1d1d1b; --muted:#6b6b66; --line:#d9d9d4;
          --accent:#2f6fde; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16171a; --panel:#202226; --text:#ececea; --muted:#9a9a95; --line:#34363b;
            --accent:#6b9cf0; }
  }
  * { box-sizing:border-box; }
  html, body { margin:0; height:100%; background:var(--bg); color:var(--text);
               font:14px/1.4 system-ui, sans-serif; }
  #vista { position:fixed; inset:0; }
  .panel { position:fixed; top:16px; left:16px; right:16px; max-width:360px; background:var(--panel);
           border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  h1 { font-size:15px; margin:0 0 8px; }
  .botones { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
  button { border:1px solid var(--line); background:transparent; color:var(--text);
           padding:6px 10px; border-radius:6px; cursor:pointer; font:inherit; }
  button.activo { background:var(--accent); border-color:var(--accent); color:#fff; }
  .dims { color:var(--muted); font-size:13px; }
  .dims b { color:var(--text); font-weight:600; }
  .sw { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:6px;
        border:1px solid var(--line); vertical-align:-1px; }
  .etiqueta { color:var(--muted); font-size:12px; margin:4px 0 4px; }
  .coste { margin-top:6px; font-size:13px; }
  .ayuda { color:var(--muted); font-size:12px; margin-top:6px; }
</style>
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
} }
</script>
</head>
<body>
<div id="vista"></div>
<div class="panel">
  <h1>Deck box</h1>
  <div class="botones">
    <button data-modo="separadas" class="activo">Separadas</button>
    <button data-modo="montada">Montada</button>
    <button data-modo="base">Solo base</button>
    <button data-modo="tapa">Solo tapa</button>
  </div>
  <div class="etiqueta">Filamento (PLA básico, un solo color para las dos piezas)</div>
  <div class="botones" id="filamentos"></div>
  <div class="dims" id="dims"></div>
  <div class="coste" id="coste"></div>
  <div class="ayuda">Arrastra para girar · rueda para zoom · botón derecho para mover</div>
</div>
<script type="module">
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const DATOS = __DATOS__;
const css = getComputedStyle(document.documentElement);
const color = n => new THREE.Color(css.getPropertyValue(n).trim());

const cont = document.getElementById("vista");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
cont.appendChild(renderer.domElement);

const escena = new THREE.Scene();
escena.background = color("--bg");
const camara = new THREE.PerspectiveCamera(40, 1, 1, 5000);
camara.up.set(0, 0, 1);
camara.position.set(260, -260, 200);
const controles = new OrbitControls(camara, renderer.domElement);
controles.enableDamping = true;

escena.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.6));
const sol = new THREE.DirectionalLight(0xffffff, 1.6);
sol.position.set(150, -200, 300);
escena.add(sol);
const rejilla = new THREE.GridHelper(400, 40, color("--line"), color("--line"));
rejilla.rotation.x = Math.PI / 2;
escena.add(rejilla);

const loader = new STLLoader();
const geom = nombre => {
  const bin = Uint8Array.from(atob(DATOS.piezas[nombre].stl), c => c.charCodeAt(0));
  return loader.parse(bin.buffer);
};
const mat = (c, transparente) => new THREE.MeshStandardMaterial({
  color: c, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide,
  transparent: transparente, opacity: transparente ? 0.35 : 1, depthWrite: !transparente });

// Colores de PLA básico: suelen ser los más baratos de cada marca
const FILAMENTOS = [
  { nombre: "Negro", hex: "#2b2b2d", borde: "#8a8a8a" },
  { nombre: "Blanco", hex: "#efefeb", borde: "#9a9a96" },
  { nombre: "Gris", hex: "#8e9196", borde: "#45474b" },
];
const base = new THREE.Mesh(geom("deckbox_base"), mat(0xffffff, false));
const tapa = new THREE.Mesh(geom("deckbox_tapa"), mat(0xffffff, false));
const matBorde = new THREE.LineBasicMaterial({ color: 0x888888 });
for (const m of [base, tapa]) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), matBorde));
escena.add(base, tapa);

function filamento(fil) {
  base.material.color.set(fil.hex);
  tapa.material.color.set(fil.hex);
  matBorde.color.set(fil.borde);
  document.querySelectorAll("[data-fil]").forEach(b => b.classList.toggle("activo", b.dataset.fil === fil.nombre));
}
const zonaFil = document.getElementById("filamentos");
for (const fil of FILAMENTOS) {
  const b = document.createElement("button");
  b.dataset.fil = fil.nombre;
  b.innerHTML = `<span class="sw" style="background:${fil.hex}"></span>${fil.nombre}`;
  b.onclick = () => filamento(fil);
  zonaFil.appendChild(b);
}

const [bx, by, bz] = DATOS.piezas.deckbox_base.dims;
const [tx, ty, tz] = DATOS.piezas.deckbox_tapa.dims;
const off = DATOS.offset;

function modo(m) {
  base.visible = m !== "tapa";
  tapa.visible = m !== "base";
  tapa.rotation.set(0, 0, 0);
  tapa.material.transparent = false; tapa.material.opacity = 1; tapa.material.depthWrite = true;
  base.position.set(0, 0, 0);
  tapa.position.set(0, 0, 0);
  if (m === "separadas") {
    base.position.set(-bx - 10, -by / 2, 0);
    tapa.position.set(10, -ty / 2, 0);
  } else if (m === "montada") {
    // la tapa se da la vuelta y cubre la base
    tapa.rotation.x = Math.PI;
    tapa.material.transparent = true; tapa.material.opacity = 0.35; tapa.material.depthWrite = false;
    base.position.set(-bx / 2, -by / 2, 0);
    tapa.position.set(-bx / 2 - off, ty - off - by / 2, tz);
  } else if (m === "base") {
    base.position.set(-bx / 2, -by / 2, 0);
  } else {
    tapa.position.set(-tx / 2, -ty / 2, 0);
  }
  tapa.material.needsUpdate = true;
  controles.target.set(0, 0, m === "base" ? bz / 2 : tz / 2);
  document.querySelectorAll("[data-modo]").forEach(b => b.classList.toggle("activo", b.dataset.modo === m));
}
document.querySelectorAll("[data-modo]").forEach(b => b.onclick = () => modo(b.dataset.modo));

const f = n => n.toFixed(1).replace(".0", "");
const gb = DATOS.piezas.deckbox_base.gramos, gt = DATOS.piezas.deckbox_tapa.gramos;
document.getElementById("dims").innerHTML =
  `<div>Base <b>${f(bx)} × ${f(by)} × ${f(bz)} mm</b> · ~${Math.round(gb)} g</div>` +
  `<div>Tapa <b>${f(tx)} × ${f(ty)} × ${f(tz)} mm</b> · ~${Math.round(gt)} g</div>`;
const total = gb + gt;
document.getElementById("coste").innerHTML =
  `Total <b>~${Math.round(total)} g</b> · <b>~${(total / 1000 * DATOS.precioKg).toFixed(2).replace(".", ",")} €</b>` +
  ` <span class="dims">(a ${DATOS.precioKg} €/kg)</span>`;
filamento(FILAMENTOS[0]);

function ajustar() {
  const w = cont.clientWidth, h = cont.clientHeight;
  renderer.setSize(w, h);
  camara.aspect = w / h;
  camara.updateProjectionMatrix();
}
addEventListener("resize", ajustar);
ajustar();
modo("separadas");
renderer.setAnimationLoop(() => { controles.update(); renderer.render(escena, camara); });
</script>
</body>
</html>
"""


if __name__ == "__main__":
    main()

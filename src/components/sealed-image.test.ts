import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SealedImage } from "./sealed-image";

const product = {
  name: "Bloomburrow Play Booster Box",
  category: "booster_box",
  imageUrl: "https://www.magicbarcelona.net/wp-content/uploads/2026/09/blb-box-300x300.png",
  setIconUrl: "https://svgs.scryfall.io/sets/blb.svg",
};
const render = (props: Partial<Parameters<typeof SealedImage>[0]>) => renderToStaticMarkup(createElement(SealedImage, { ...product, ...props }));

describe("SealedImage", () => {
  it("con foto: la de la tienda, entera, en diferido y sin referer", () => {
    const html = render({});
    expect(html).toContain(`src="${product.imageUrl}"`);
    expect(html).toContain(`alt="${product.name}"`);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain("object-contain");
    expect(html).not.toContain("svgs.scryfall.io");
  });

  it("la imagen principal de la página no se carga en diferido", () => {
    const html = render({ eager: true, size: "lg" });
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchPriority="high"');
  });

  it("sin foto: el símbolo de la edición, decorativo, sobre el color de su familia", () => {
    const html = render({ imageUrl: null });
    expect(html).toContain(`src="${product.setIconUrl}"`);
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("bg-brand-soft");
    expect(html).toContain("dark:invert");
  });

  it("sin foto ni símbolo: el icono de la familia", () => {
    const html = render({ imageUrl: null, setIconUrl: null, category: "bundle" });
    expect(html).not.toContain("<img");
    expect(html).toContain("<svg");
    expect(html).toContain("bg-good-soft");
  });
});

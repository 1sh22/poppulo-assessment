class SimpleDOMMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  is2D = true;
  isIdentity: boolean;

  static fromFloat32Array(array: Float32Array) {
    return new SimpleDOMMatrix(Array.from(array));
  }

  static fromFloat64Array(array: Float64Array) {
    return new SimpleDOMMatrix(Array.from(array));
  }

  static fromMatrix(
    other?:
      | SimpleDOMMatrix
      | [number, number, number, number, number, number]
      | number[],
  ) {
    return new SimpleDOMMatrix(other);
  }

  constructor(
    init?:
      | SimpleDOMMatrix
      | [number, number, number, number, number, number]
      | number[],
  ) {
    const values = normalizeMatrixInit(init);
    this.a = values[0];
    this.b = values[1];
    this.c = values[2];
    this.d = values[3];
    this.e = values[4];
    this.f = values[5];
    this.isIdentity = isIdentityMatrix(values);
  }

  multiplySelf(other: SimpleDOMMatrix): this {
    const next = multiply(this.toArray(), toArray(other));
    this.apply(next);
    return this;
  }

  preMultiplySelf(other: SimpleDOMMatrix): this {
    const next = multiply(toArray(other), this.toArray());
    this.apply(next);
    return this;
  }

  translate(tx = 0, ty = 0): SimpleDOMMatrix {
    return new SimpleDOMMatrix(this.toArray()).translateSelf(tx, ty);
  }

  translateSelf(tx = 0, ty = 0): this {
    const next = multiply(this.toArray(), [1, 0, 0, 1, tx, ty]);
    this.apply(next);
    return this;
  }

  scale(scaleX = 1, scaleY = scaleX): SimpleDOMMatrix {
    return new SimpleDOMMatrix(this.toArray()).scaleSelf(scaleX, scaleY);
  }

  scaleSelf(scaleX = 1, scaleY = scaleX): this {
    const next = multiply(this.toArray(), [scaleX, 0, 0, scaleY, 0, 0]);
    this.apply(next);
    return this;
  }

  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c;
    if (!Number.isFinite(det) || Math.abs(det) < Number.EPSILON) {
      this.apply([NaN, NaN, NaN, NaN, NaN, NaN]);
      return this;
    }

    this.apply([
      this.d / det,
      -this.b / det,
      -this.c / det,
      this.a / det,
      (this.c * this.f - this.d * this.e) / det,
      (this.b * this.e - this.a * this.f) / det,
    ]);
    return this;
  }

  toArray(): [number, number, number, number, number, number] {
    return [this.a, this.b, this.c, this.d, this.e, this.f];
  }

  private apply(values: [number, number, number, number, number, number]) {
    this.a = values[0];
    this.b = values[1];
    this.c = values[2];
    this.d = values[3];
    this.e = values[4];
    this.f = values[5];
    this.isIdentity = isIdentityMatrix(values);
  }
}

function normalizeMatrixInit(
  init?:
    | SimpleDOMMatrix
    | [number, number, number, number, number, number]
    | number[],
): [number, number, number, number, number, number] {
  if (!init) return [1, 0, 0, 1, 0, 0];
  if (init instanceof SimpleDOMMatrix) return init.toArray();
  if (Array.isArray(init)) {
    if (init.length >= 6) {
      return [init[0] ?? 1, init[1] ?? 0, init[2] ?? 0, init[3] ?? 1, init[4] ?? 0, init[5] ?? 0];
    }
  }
  return [1, 0, 0, 1, 0, 0];
}

function toArray(
  matrix: Pick<SimpleDOMMatrix, "a" | "b" | "c" | "d" | "e" | "f">,
): [number, number, number, number, number, number] {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
}

function multiply(
  left: [number, number, number, number, number, number],
  right: [number, number, number, number, number, number],
): [number, number, number, number, number, number] {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function isIdentityMatrix(values: readonly number[]): boolean {
  return (
    values[0] === 1 &&
    values[1] === 0 &&
    values[2] === 0 &&
    values[3] === 1 &&
    values[4] === 0 &&
    values[5] === 0
  );
}

export function ensurePdfServerPolyfills() {
  if (typeof globalThis.DOMMatrix === "undefined") {
    globalThis.DOMMatrix = SimpleDOMMatrix as unknown as typeof DOMMatrix;
  }
}

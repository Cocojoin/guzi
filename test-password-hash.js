// 测试密码哈希生成
const HASH_PREFIX = "sha256$";

function rightRotate(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256(ascii) {
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = "length";
  let i;
  let j;
  let result = "";

  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

  const hash = sha256.h = sha256.h || [];
  const k = sha256.k = sha256.k || [];
  let primeCounter = k[lengthProperty];
  const isComposite = {};

  for (let candidate = 2; primeCounter < 64; candidate += 1) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      primeCounter += 1;
    }
  }

  ascii += "\x80";
  while ((ascii[lengthProperty] % 64) - 56) {
    ascii += "\x00";
  }
  for (i = 0; i < ascii[lengthProperty]; i += 1) {
    j = ascii.charCodeAt(i);
    if (j >> 8) {
      throw new Error("Only ASCII is supported");
    }
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  for (j = 0; j < words[lengthProperty];) {
    const w = words.slice(j, j += 16);
    const oldHash = hash.slice(0);
    let a = oldHash[0];
    let b = oldHash[1];
    let c = oldHash[2];
    let d = oldHash[3];
    let e = oldHash[4];
    let f = oldHash[5];
    let g = oldHash[6];
    let h = oldHash[7];

    for (i = 0; i < 64; i += 1) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const s0 = i < 16 ? w[i] : (
        w[i - 16]
        + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
        + w[i - 7]
        + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
      ) | 0;
      w[i] = s0;

      const temp1 = (
        h
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & f) ^ (~e & g))
        + k[i]
        + w[i]
      ) | 0;
      const temp2 = (
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & b) ^ (a & c) ^ (b & c))
      ) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  for (i = 0; i < hash[lengthProperty]; i += 1) {
    for (j = 3; j + 1; j -= 1) {
      const byte = (hash[i] >> (j * 8)) & 255;
      result += ((byte < 16) ? 0 : "") + byte.toString(16);
    }
  }
  return result;
}

function normalizePasswordInput(password) {
  return String(password == null ? "" : password);
}

function hashPassword(password) {
  const normalized = normalizePasswordInput(password);
  return `${HASH_PREFIX}${sha256(normalized)}`;
}

// 测试
console.log('=== 测试密码哈希生成 ===');
const password = 'cc19980905';
const hashed = hashPassword(password);
console.log('明文密码:', password);
console.log('生成的哈希:', hashed);
console.log();

// 与数据库中存储的对比
const storedHash = 'sha256$c514312cdb1693109ae9b0db485a1d3e66eaa71378788fdd4bbb009a24a30216';
console.log('数据库中存储的哈希:', storedHash);
console.log('是否匹配:', hashed === storedHash);
console.log();

// 对比哈希值部分
console.log('生成的哈希值部分:', hashed.replace(HASH_PREFIX, ''));
console.log('存储的哈希值部分:', storedHash.replace(HASH_PREFIX, ''));
console.log('哈希值部分是否匹配:', hashed.replace(HASH_PREFIX, '') === storedHash.replace(HASH_PREFIX, ''));

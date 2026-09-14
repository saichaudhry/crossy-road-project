// Playable characters. Each one is only a palette plus a couple of shape
// switches -- the voxel model is built procedurally from these numbers, so a
// new character costs six lines and no art assets.

export const CHARACTERS = [
  {
    id: 'chicken', name: 'Chicken', price: 0,
    body: 0xf5f5f5, accent: 0xf6a623, detail: 0xe4453a, eye: 0x1b1b1b,
    crest: 'comb', beak: true, tail: true,
  },
  {
    id: 'duck', name: 'Duck', price: 60,
    body: 0xfbe27a, accent: 0xf0862c, detail: 0xf0862c, eye: 0x1b1b1b,
    crest: 'none', beak: true, tail: true,
  },
  {
    id: 'penguin', name: 'Penguin', price: 120,
    body: 0x2c3040, accent: 0xf6a623, detail: 0xf7f7f7, eye: 0xffffff,
    crest: 'none', beak: true, tail: false, belly: true,
  },
  {
    id: 'frog', name: 'Frog', price: 180,
    body: 0x5cb85c, accent: 0x3e8f3e, detail: 0xf7f7f7, eye: 0x1b1b1b,
    crest: 'eyes', beak: false, tail: false,
  },
  {
    id: 'robot', name: 'Robot', price: 260,
    body: 0x9aa5b1, accent: 0x4a5568, detail: 0x4ad9d9, eye: 0x4ad9d9,
    crest: 'antenna', beak: false, tail: false,
  },
  {
    id: 'cat', name: 'Cat', price: 340,
    body: 0x3a3a44, accent: 0xf39c9c, detail: 0xf7f7f7, eye: 0x8ee36b,
    crest: 'ears', beak: false, tail: true,
  },
];

export const DEFAULT_CHARACTER = CHARACTERS[0].id;

export const getCharacter = (id) =>
  CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];

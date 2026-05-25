export function nanoid(size = 21) {
    let id = '';
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-';
    const charsLength = chars.length;
    for (let i = 0; i < size; i++) {
        id += chars[Math.floor(Math.random() * charsLength)];
    }
    return id;
}
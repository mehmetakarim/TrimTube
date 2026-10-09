//! normalizer-tr için WebAssembly sarmalayıcı (TrimTube, EMA Lightning metin ön işleme).
//! Sözleşme: alloc(n) → bellek; normalize(ptr, len) → (sonuç_ptr << 32) | sonuç_len; free(ptr, len).
//! "fallback" politikası: çözülemeyen yazım olduğu gibi okunur, hiçbir şey sessizce düşmez.
use normalizer_tr::{AmbiguityPolicy, NormalizeOptions, Normalizer};
use std::sync::OnceLock;

static NORMALIZER: OnceLock<Option<Normalizer>> = OnceLock::new();

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn free(ptr: *mut u8, len: usize) {
    unsafe { drop(Vec::from_raw_parts(ptr, 0, len.max(1))) };
}

fn leak(s: String) -> u64 {
    let mut bytes = s.into_bytes();
    bytes.shrink_to_fit();
    let (ptr, len) = (bytes.as_mut_ptr() as u64, bytes.len() as u64);
    std::mem::forget(bytes);
    (ptr << 32) | len
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn normalize(ptr: *const u8, len: usize) -> u64 {
    let input = unsafe { std::slice::from_raw_parts(ptr, len) };
    let text = String::from_utf8_lossy(input).into_owned();
    let normalizer = NORMALIZER.get_or_init(|| Normalizer::new().ok());
    let Some(normalizer) = normalizer else { return leak(text) };
    let options = NormalizeOptions { ambiguity_policy: AmbiguityPolicy::Fallback, ..Default::default() };
    match normalizer.normalize(&text, &options) {
        Ok(result) => leak(result.normalized_text().to_owned()),
        Err(_) => leak(text), // geçersiz girdi/sınır: kelimeler kaybolmasın, olduğu gibi döner
    }
}

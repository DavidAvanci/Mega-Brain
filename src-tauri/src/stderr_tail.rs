use std::collections::VecDeque;
use std::io::{ErrorKind, Read};

const STDERR_TAIL_BYTES: usize = 64 * 1024;

/// Keep draining the pipe, retaining only recent diagnostics, even without newlines.
pub(crate) fn read_stderr_tail(mut reader: impl Read) -> String {
    let mut tail = VecDeque::with_capacity(STDERR_TAIL_BYTES);
    let mut chunk = [0_u8; 8192];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(size) => {
                let overflow = (tail.len() + size).saturating_sub(STDERR_TAIL_BYTES);
                tail.drain(..overflow);
                tail.extend(&chunk[..size]);
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(tail.make_contiguous()).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn drains_large_output_without_newlines_and_keeps_the_latest_failure() {
        let mut output = vec![b'x'; 10 * 1024 * 1024];
        let failure = b"node: command not found";
        output.extend(failure);
        let mut reader = Cursor::new(output);
        let tail = read_stderr_tail(&mut reader);
        assert_eq!(reader.position(), reader.get_ref().len() as u64);
        assert_eq!(tail.len(), STDERR_TAIL_BYTES);
        assert!(tail.ends_with("node: command not found"));
    }

    #[test]
    fn preserves_small_diagnostics_and_handles_split_utf8() {
        assert_eq!(read_stderr_tail(Cursor::new("diagnóstico")), "diagnóstico");
        let output = "€".repeat(STDERR_TAIL_BYTES);
        assert!(read_stderr_tail(Cursor::new(output)).ends_with('€'));
    }
}

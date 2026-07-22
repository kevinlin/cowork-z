//! Pure cron math shared by the automation scheduler and `validate_cron`.
//! Named `cron_schedule` to avoid confusion with the extern `cron` crate.

use chrono::{DateTime, Local, Utc};
use cron::Schedule;
use std::str::FromStr;

/// Normalize a cron expression for the `cron` crate which requires 6-7 fields
/// (sec min hour dom month dow [year]). Standard 5-field Unix cron (min hour dom month dow)
/// is converted by prepending "0" for seconds.
///
/// The `cron` crate interprets numeric day-of-week as 1-indexed Sunday-first
/// (1=Sun … 7=Sat), whereas standard Unix cron uses 0-indexed (0=Sun … 6=Sat).
/// To avoid mismatches we replace the dow field with named abbreviations.
pub fn normalize(expr: &str) -> String {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() == 5 {
        let dow_converted = convert_dow_to_named(fields[4]);
        format!(
            "0 {} {} {} {} {}",
            fields[0], fields[1], fields[2], fields[3], dow_converted
        )
    } else {
        expr.to_string()
    }
}

/// Next fire time for a (5-field Unix or 6/7-field) cron expression, evaluated
/// against the system's local timezone and converted to UTC. `None` if the
/// expression is invalid or has no upcoming fire.
pub fn next_fire(expr: &str) -> Option<DateTime<Utc>> {
    let normalized = normalize(expr);
    let schedule = Schedule::from_str(&normalized).ok()?;
    schedule.upcoming(Local).next().map(|t| t.with_timezone(&Utc))
}

fn convert_dow_to_named(field: &str) -> String {
    const NAMES: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    if field == "*" {
        return field.to_string();
    }

    let mut parts: Vec<String> = Vec::new();
    for segment in field.split(',') {
        if let Some(slash_pos) = segment.find('/') {
            let (base, step) = segment.split_at(slash_pos);
            let converted_base = convert_dow_segment(base, &NAMES);
            parts.push(format!("{}{}", converted_base, step));
        } else {
            parts.push(convert_dow_segment(segment, &NAMES));
        }
    }
    parts.join(",")
}

fn convert_dow_segment(segment: &str, names: &[&str; 7]) -> String {
    if segment == "*" {
        return segment.to_string();
    }
    if let Some((start_s, end_s)) = segment.split_once('-') {
        let start = dow_to_name(start_s, names);
        let end = dow_to_name(end_s, names);
        format!("{}-{}", start, end)
    } else {
        dow_to_name(segment, names)
    }
}

fn dow_to_name(value: &str, names: &[&str; 7]) -> String {
    match value.parse::<u8>() {
        Ok(n) => names[(n % 7) as usize].to_string(),
        Err(_) => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_prepends_seconds_to_5_field() {
        let cases = [
            ("0 9 * * *", "0 0 9 * * *"),
            ("30 14 1 * *", "0 30 14 1 * *"),
            ("*/15 * * * *", "0 */15 * * * *"),
        ];
        for (input, expected) in cases {
            assert_eq!(normalize(input), expected, "input: {input}");
        }
    }

    #[test]
    fn normalize_passes_through_6_and_7_field() {
        let cases = [
            "0 0 9 * * *",          // 6-field
            "0 0 9 * * Mon 2027",   // 7-field
        ];
        for input in cases {
            assert_eq!(normalize(input), input, "input: {input}");
        }
    }

    #[test]
    fn normalize_remaps_unix_dow_to_named() {
        // Unix dow is 0-indexed Sunday-first; the cron crate is 1-indexed.
        let cases = [
            ("0 9 * * 1-5", "0 0 9 * * Mon-Fri"),
            ("0 9 * * 1,3,5", "0 0 9 * * Mon,Wed,Fri"),
            ("0 9 * * 5", "0 0 9 * * Fri"),
            ("0 9 * * 0", "0 0 9 * * Sun"),
            ("0 9 * * 7", "0 0 9 * * Sun"),
            ("0 9 * * */2", "0 0 9 * * */2"),
            ("0 9 * * *", "0 0 9 * * *"),
            ("0 9 * * Mon-Fri", "0 0 9 * * Mon-Fri"),
        ];
        for (input, expected) in cases {
            assert_eq!(normalize(input), expected, "input: {input}");
        }
    }

    #[test]
    fn next_fire_valid_expression_returns_some() {
        let cases = ["0 9 * * *", "*/5 * * * *", "0 9 * * 1-5", "0 0 9 * * Mon"];
        for expr in cases {
            assert!(next_fire(expr).is_some(), "expr: {expr}");
        }
    }

    #[test]
    fn next_fire_invalid_expression_returns_none() {
        let cases = ["* \\5 * * 1-5", "not a cron", "99 99 * * *"];
        for expr in cases {
            assert!(next_fire(expr).is_none(), "expr: {expr}");
        }
    }

    #[test]
    fn next_fire_is_in_the_future() {
        let next = next_fire("*/5 * * * *").expect("valid expr");
        assert!(next > Utc::now());
    }
}

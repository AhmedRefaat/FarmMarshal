//! community.rs — Video (F4b) · Marketplace (F6) · Academy (F7)
//! ===========================================================================
//! Pure domain functions mirroring `server-node/src/community.ts`, with the
//! same fixture-tested numbers (bounty split, grading boundary).

use crate::store::Db;
use crate::types::*;

/// Pure bounty split — piastre rounding, fixture-tested.
pub fn split_bounty(bounty_egp: f64, commission_pct: f64) -> (f64, f64) {
    let commission = (bounty_egp * commission_pct / 100.0 * 100.0).round() / 100.0;
    (commission, ((bounty_egp - commission) * 100.0).round() / 100.0)
}

/// Uber-style KYC gate: only VERIFIED experts above reputation floor may answer.
pub fn can_respond(db: &Db, responder_id: &str) -> Result<(), &'static str> {
    let Some(e) = db.experts.iter().find(|e| e.user_id == responder_id) else {
        return Err("only VERIFIED experts may respond");
    };
    if e.status != "verified" {
        return Err("only VERIFIED experts may respond");
    }
    if e.avg_stars > 0.0 && e.avg_stars < 2.0 {
        return Err("reputation below minimum threshold");
    }
    Ok(())
}

/**
 * Grade an attempt SERVER-SIDE. Answer keys never leave the server; boundary
 * is exact: scorePct >= passThreshold ⇒ pass (90.0 passes @90% threshold).
 */
pub fn grade_attempt(db: &mut Db, quiz_id: &str, user_id: &str, answers: &[(String, String)]) -> Result<QuizAttempt, &'static str> {
    let quiz = db.quizzes.iter().find(|q| q.id == quiz_id && q.status == "published").ok_or("quiz not available")?;
    let questions: Vec<&QuizQuestion> = db.questions.iter().filter(|q| q.quiz_id == quiz_id).collect();
    let total: f64 = questions.iter().map(|q| q.points).sum();
    let mut earned = 0.0f64;
    for qq in &questions {
        if let Some((_, given)) = answers.iter().find(|(qid, _)| qid == &qq.id) {
            if given == &qq.answer_key {
                earned += qq.points;
            }
        }
    }
    let score_pct = if total == 0.0 { 0.0 } else { (earned / total * 1000.0).round() / 10.0 };
    let attempt = QuizAttempt {
        id: format!("att-{}", uuid::Uuid::new_v4()),
        quiz_id: quiz_id.to_string(),
        user_id: user_id.to_string(),
        score_pct,
        passed: score_pct >= quiz.pass_threshold_pct,
        completed_at: crate::util::now_ms(),
    };
    db.attempts.push(attempt.clone());
    Ok(attempt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounty_split_rounds_to_piastres() {
        assert_eq!(split_bounty(100.0, 15.0), (15.0, 85.0));
        assert_eq!(split_bounty(99.99, 15.0), (15.0, 84.99));
    }

    #[test]
    fn grading_boundary_exact() {
        // 1 of 2 points @ 90% threshold ⇒ 50% fail; 2 of 2 ⇒ 100% pass.
        let mut db = crate::store::seed();
        db.quizzes.push(Quiz { id: "qz-t".into(), title: "t".into(), author_id: "e".into(), pass_threshold_pct: 90.0, status: "published".into(), created_at: 0 });
        db.questions.push(QuizQuestion { id: "qq-1".into(), quiz_id: "qz-t".into(), q_type: "true_false".into(), prompt: "p".into(), options: vec![], answer_key: "true".into(), points: 1.0 });
        db.questions.push(QuizQuestion { id: "qq-2".into(), quiz_id: "qz-t".into(), q_type: "true_false".into(), prompt: "p".into(), options: vec![], answer_key: "false".into(), points: 1.0 });
        let half = grade_attempt(&mut db, "qz-t", "l", &[("qq-1".into(), "true".into()), ("qq-2".into(), "true".into())]).unwrap();
        assert_eq!(half.score_pct, 50.0);
        assert!(!half.passed);
        let full = grade_attempt(&mut db, "qz-t", "l", &[("qq-1".into(), "true".into()), ("qq-2".into(), "false".into())]).unwrap();
        assert_eq!(full.score_pct, 100.0);
        assert!(full.passed);
    }
}

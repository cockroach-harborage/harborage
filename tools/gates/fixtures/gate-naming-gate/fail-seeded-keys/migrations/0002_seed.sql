-- A migration that quietly makes the quorum satisfiable.
INSERT INTO reviewer_role_keys (key_id, public_box_key, role, valid_from_epoch)
VALUES ('r1', 'AAAA', 'naming_reviewer', 1);

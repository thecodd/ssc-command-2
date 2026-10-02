-- ============ 006 entity registry ============
select pg_temp.check_('006 integrity report is clean on fixtures', (select count(*) from entities_integrity_report()) = 0);
select pg_temp.check_('006 every curriculum fixture is registered', (select count(*) from entities where id in ('@CH1@','@T1@','@ST1@','@Q1@')) = 4);
select pg_temp.check_('006 registry type matches kind', (select type from entities where id = '@T1@') = 'ssc_topic');
-- references must point at real entities of the right type
select pg_temp.check_('006 note on a nonexistent entity rejected', pg_temp.rows_as('@A@', $$insert into notes (user_id, entity_type, entity_id, content) values ('@A@', 'ssc_topic', '99999999-0000-0000-0000-000000000000', 'x')$$) = -1);
select pg_temp.check_('006 note with the WRONG entity type rejected (chapter id typed as topic)', pg_temp.rows_as('@A@', $$insert into notes (user_id, entity_type, entity_id, content) values ('@A@', 'ssc_topic', '@CH1@', 'x')$$) = -1);
select pg_temp.check_('006 note on a real entity accepted', pg_temp.rows_as('@A@', $$insert into notes (user_id, entity_type, entity_id, content) values ('@A@', 'ncert_chapter', '@CH1@', 'ok')$$) = 1);
select pg_temp.check_('006 progress type allow-list (pyq not trackable)', pg_temp.owner_try($$insert into user_progress (user_id, entity_type, entity_id, status) values ('@A@', 'pyq', '@Q1@', 'learning')$$) = -1);
select pg_temp.check_('006 half task reference rejected by the pair check', pg_temp.owner_try($$insert into tasks (user_id, title, entity_id) values ('@A@', 'x', '@T1@')$$) = -1);
-- a curriculum row cannot exist without its registry row (deferred FK; forced immediate for the test)
-- PostgreSQL refuses ALTER TABLE while deferred constraint-trigger events are pending, and the fixtures above queued some (chapters_entity_fk is DEFERRABLE INITIALLY DEFERRED).
-- Settle them first (this also validates every deferred registry reference queued so far), run the integrity assertion with the constraint IMMEDIATE, then restore deferral.
set constraints all immediate;
alter table public.chapters disable trigger entity_register;
select pg_temp.check_('006 curriculum row without registry row is rejected', pg_temp.owner_try($$insert into chapters (book_id, title) values ('@BK1@', 'TEST unregistered')$$) = -1);
alter table public.chapters enable trigger entity_register;
set constraints all deferred;
-- a registry row without a curriculum row is DETECTED by the audit (not prevented by a constraint: documented limitation)
insert into entities (id, type) values ('@ORPHAN@', 'pyq');
select pg_temp.check_('006 audit reports an orphan registry row', (select count(*) from entities_integrity_report() where id = '@ORPHAN@') = 1);
delete from entities where id = '@ORPHAN@';
select pg_temp.check_('006 audit is clean again', (select count(*) from entities_integrity_report()) = 0);
-- delete cascades to the owner's own references; archive keeps them
insert into chapters (id, book_id, title, owner_id) values ('@CHX@', '@BK1@', 'TEST A custom for registry', '@A@');
insert into notes (user_id, entity_type, entity_id, content) values ('@A@', 'ncert_chapter', '@CHX@', 'note on custom');
update chapters set archived = true where id = '@CHX@';
select pg_temp.check_('006 archiving does not unregister or cascade', (select count(*) from entities where id = '@CHX@') = 1 and (select count(*) from notes where entity_id = '@CHX@') = 1);
delete from chapters where id = '@CHX@';
select pg_temp.check_('006 deleting a custom entity unregisters it', (select count(*) from entities where id = '@CHX@') = 0);
select pg_temp.check_('006 ... and cascades the owner references', (select count(*) from notes where entity_id = '@CHX@') = 0);
select pg_temp.check_('006 clients cannot read or write the registry', pg_temp.rows_as('@A@', 'select 1 from entities') = -1 and pg_temp.rows_as('@A@', $$insert into entities (id, type) values (gen_random_uuid(), 'pyq')$$) = -1);
select pg_temp.check_('006 anonymous cannot touch the registry', pg_temp.rows_as(null, 'select 1 from entities') = -1);

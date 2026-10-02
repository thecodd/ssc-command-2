-- Search v2: adds NCERT books, SSC subjects, resources and tasks; returns a ready-made href.
drop function if exists global_search(text, int);
create function global_search(q text, lim int default 5)
returns table(kind text, id uuid, title text, subtitle text, href text)
language sql stable security invoker set search_path = public, extensions as $$
  with p as (select '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat)
  (select 'book'::text, b.id, b.title, ('Class ' || cl.grade || ' · ' || s.name)::text, ('/ncert/' || cl.grade)::text
     from books b join subjects s on s.id = b.subject_id join classes cl on cl.id = s.class_id, p
     where coalesce(b.archived,false) = false and b.title ilike p.pat order by similarity(b.title, q) desc limit lim)
  union all
  (select 'chapter'::text, c.id, c.title, ('Class ' || cl.grade || ' · ' || s.name)::text, ('/ncert/chapter/' || c.id)::text
     from chapters c join books b on b.id = c.book_id join subjects s on s.id = b.subject_id join classes cl on cl.id = s.class_id, p
     where coalesce(c.archived,false) = false and c.title ilike p.pat order by similarity(c.title, q) desc limit lim)
  union all
  (select 'concept'::text, k.id, k.title, c.title::text, ('/ncert/chapter/' || c.id || '?tab=concepts')::text
     from concepts k join chapters c on c.id = k.chapter_id, p where k.title ilike p.pat order by similarity(k.title, q) desc limit lim)
  union all
  (select 'ssc_subject'::text, s.id, s.name, (tr.name)::text, ('/ssc/subject/' || s.id)::text
     from ssc_subjects s join ssc_tiers tr on tr.id = s.tier_id, p where coalesce(s.archived,false) = false and s.name ilike p.pat limit lim)
  union all
  (select 'ssc_topic'::text, t.id, t.title, s.name::text, ('/ssc/topic/' || t.id)::text
     from ssc_topics t join ssc_subjects s on s.id = t.subject_id, p
     where coalesce(t.archived,false) = false and t.title ilike p.pat order by similarity(t.title, q) desc limit lim)
  union all
  (select 'ssc_subtopic'::text, st.id, st.title, t.title::text, ('/ssc/topic/' || t.id)::text
     from ssc_subtopics st join ssc_topics t on t.id = st.topic_id, p where st.title ilike p.pat order by similarity(st.title, q) desc limit lim)
  union all
  (select 'note'::text, n.id, coalesce(nullif(n.title,''), 'Untitled note')::text, left(coalesce(n.content,''), 80)::text,
     (case n.entity_type when 'ncert_chapter' then '/ncert/chapter/' || n.entity_id || '?tab=notes' when 'ssc_topic' then '/ssc/topic/' || n.entity_id else '/notes' end)::text
     from notes n, p where n.title ilike p.pat or n.content ilike p.pat order by n.updated_at desc limit lim)
  union all
  (select 'pyq'::text, y.id, left(y.question, 90)::text, (coalesce(y.exam,'') || ' ' || coalesce(y.year::text,''))::text, '/pyqs'::text
     from pyqs y, p where y.question ilike p.pat order by y.year desc nulls last limit lim)
  union all
  (select 'resource'::text, r.id, r.title, coalesce(r.type::text,'')::text,
     (case r.entity_type when 'ncert_chapter' then '/ncert/chapter/' || r.entity_id || '?tab=resources' when 'ssc_topic' then '/ssc/topic/' || r.entity_id else '/resources' end)::text
     from resources r, p where r.title ilike p.pat or r.description ilike p.pat limit lim)
  union all
  (select 'task'::text, k.id, k.title, coalesce(k.status::text,'')::text, '/tasks'::text
     from tasks k, p where k.title ilike p.pat or k.description ilike p.pat limit lim);
$$;
create index if not exists books_title_trgm on books using gin (title gin_trgm_ops);
create index if not exists ssc_subjects_name_trgm on ssc_subjects using gin (name gin_trgm_ops);
create index if not exists resources_title_trgm on resources using gin (title gin_trgm_ops);
create index if not exists tasks_title_trgm on tasks using gin (title gin_trgm_ops);

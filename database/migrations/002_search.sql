-- Global search across chapters, concepts, SSC topics/subtopics, notes and PYQs.
-- security invoker: RLS applies, so users only see their own notes / allowed rows.
create or replace function global_search(q text, lim int default 6)
returns table(kind text, id uuid, title text, subtitle text, parent_id uuid)
language sql stable security invoker set search_path = public, extensions as $$
  with p as (select '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat)
  (select 'chapter'::text, c.id, c.title, ('Class ' || cl.grade || ' · ' || s.name)::text, c.id
     from chapters c join books b on b.id = c.book_id join subjects s on s.id = b.subject_id join classes cl on cl.id = s.class_id, p
     where coalesce(c.archived,false) = false and c.title ilike p.pat order by similarity(c.title, q) desc limit lim)
  union all
  (select 'concept'::text, k.id, k.title, c.title::text, c.id
     from concepts k join chapters c on c.id = k.chapter_id, p where k.title ilike p.pat order by similarity(k.title, q) desc limit lim)
  union all
  (select 'ssc_topic'::text, t.id, t.title, s.name::text, t.id
     from ssc_topics t join ssc_subjects s on s.id = t.subject_id, p
     where coalesce(t.archived,false) = false and t.title ilike p.pat order by similarity(t.title, q) desc limit lim)
  union all
  (select 'ssc_subtopic'::text, st.id, st.title, t.title::text, t.id
     from ssc_subtopics st join ssc_topics t on t.id = st.topic_id, p where st.title ilike p.pat order by similarity(st.title, q) desc limit lim)
  union all
  (select 'note'::text, n.id, coalesce(nullif(n.title,''), 'Untitled note')::text, left(coalesce(n.content,''), 80)::text, n.entity_id
     from notes n, p where n.title ilike p.pat or n.content ilike p.pat order by n.updated_at desc limit lim)
  union all
  (select 'pyq'::text, y.id, left(y.question, 90)::text, (coalesce(y.exam,'') || ' ' || coalesce(y.year::text,''))::text, y.id
     from pyqs y, p where y.question ilike p.pat order by y.year desc nulls last limit lim);
$$;
-- Content-matching index for notes
create index if not exists notes_content_trgm on notes using gin (content gin_trgm_ops);

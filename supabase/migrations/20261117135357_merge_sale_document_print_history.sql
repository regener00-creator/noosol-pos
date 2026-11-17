-- Merge on the already locked sale, after checking its status and warehouse permissions.
do $migration$
declare
  definition text := pg_get_functiondef('public.update_sale_document_metadata(text,jsonb)'::regprocedure);
  marker text := 'if v_key in (''cashReceiptA4Meta'',''fullTaxInvoice'',''shortReceiptMeta'') then';
begin
  if strpos(definition,marker)=0 then raise exception 'unexpected sale document function'; end if;
  execute replace(definition,marker,$merge$
    if v_key in ('cashReceiptA4Meta','fullTaxInvoice') and jsonb_typeof(p_metadata->v_key)='object' then
      declare
        previous jsonb := v_data->v_key;
        incoming jsonb := p_metadata->v_key;
        history jsonb := case when jsonb_typeof(previous->'printLog')='array' then previous->'printLog' else '[]'::jsonb end;
        event jsonb := incoming->'printEvent';
      begin
        if incoming ? 'printEvent' then
          if nullif(previous->>'number','') is null or previous->>'number' is distinct from incoming->>'number'
            then raise exception 'document no longer matches print preview'; end if;
          if jsonb_typeof(event) is distinct from 'object' or nullif(event->>'id','') is null
            or event->>'mode' is distinct from 'print' then raise exception 'invalid print event'; end if;
          if not history @> jsonb_build_array(jsonb_build_object('id',event->>'id')) then
            history:=history||jsonb_build_array(event);
          end if;
          incoming:=previous;
        elsif jsonb_typeof(incoming->'printLog')='array' then
          -- Older clients send the whole log. Keep entries another device already saved.
          select history||coalesce(jsonb_agg(e order by n),'[]'::jsonb) into history
          from jsonb_array_elements(incoming->'printLog') with ordinality as items(e,n)
          where not history @> jsonb_build_array(e);
        end if;
        p_metadata:=jsonb_set(p_metadata,array[v_key],jsonb_set(incoming,'{printLog}',history));
      end;
    end if;
  $merge$||marker);
end $migration$;

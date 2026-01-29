create view active_shops_public as
select s.*
from shops s
where s.status = 'active'
  and exists (
    select 1
    from merchant_subscriptions ms
    where ms.merchant_id = s.merchant_id
      and ms.status = 'active'
      and ms.expires_at > now()
  );

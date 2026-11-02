select to_char(p.date,'YYYY-MM') mois, c.name categorie, c.type, a.name compte, p."isBusiness" biz, count(*) n, round(sum(p.amount),0) total
from "PersonalExpense" p left join "ExpenseCategory" c on c.id=p."categoryId" left join "PaymentAccount" a on a.id=p."accountId"
group by 1,2,3,4,5 order by 1,7 desc

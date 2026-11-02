select to_char(date,'YYYY-MM') mois, channel, count(*) jours, round(sum("amountChf"),0) pub_chf from "DailyAdSpend" group by 1,2 order by 1,2

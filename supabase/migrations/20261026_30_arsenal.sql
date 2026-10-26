-- Классическая эра 1.0 · «Арсенал»: общедоступный каталог орудий и систем.
--
-- Старый общедоступный набор (названия как в старом списке) получает приписки —
-- индекс модели и имя — и характеристики в масштабе новых конструкторов.
-- Добавлены недостающие группы: тяжёлые орудия, главный калибр, торпеды,
-- поддержка, маскировка. Всё лежит в v1_modules — той же таблице, что читает
-- верфь, чтобы потом подключить каталог к конструктору кораблей без переделок.
-- Пока позиции с in_shipyard = false видны только в вики.

set lock_timeout = '15s';

alter table public.v1_modules
  add column if not exists grp text,
  add column if not exists code text,
  add column if not exists nick text,
  add column if not exists base_name text,
  add column if not exists in_shipyard boolean not null default true;

create table if not exists public.v1_arsenal_groups (
  id      text primary key,
  section text not null check (section in ('weapons', 'systems')),
  title   text not null,
  descr   text not null,
  cover   text,          -- картинка раздела (можно залить позже); без неё рисуется схема
  sort    int not null default 0
);
alter table public.v1_arsenal_groups enable row level security;
drop policy if exists v1_arsenal_groups_read on public.v1_arsenal_groups;
create policy v1_arsenal_groups_read on public.v1_arsenal_groups for select using (true);
grant select on public.v1_arsenal_groups to anon, authenticated;

insert into public.v1_arsenal_groups(id, section, title, descr, sort) values
  ('light', 'weapons', $t$Лёгкие орудия$t$, $t$Скорострельные орудия малого калибра для корветов и точечной обороны.$t$, 10),
  ('medium', 'weapons', $t$Средние орудия$t$, $t$Основной калибр фрегатов и эсминцев.$t$, 20),
  ('heavy', 'weapons', $t$Тяжёлые орудия$t$, $t$Калибр крейсеров: медленно, тяжело и очень больно.$t$, 30),
  ('main', 'weapons', $t$Главный калибр$t$, $t$Орудия линкоров и дредноутов, решающие исход сражения.$t$, 40),
  ('missile', 'weapons', $t$Ракетное вооружение$t$, $t$Пусковые установки и торпеды: самая большая дальность.$t$, 50),
  ('flak', 'weapons', $t$Зенитное вооружение$t$, $t$Защита от ракет, дронов и авиагрупп.$t$, 60),
  ('support', 'weapons', $t$Ремонт и поддержка$t$, $t$Дроны-ремонтники и лучи, которые не стреляют, а помогают.$t$, 70),
  ('radar', 'systems', $t$Радарное оборудование$t$, $t$Связь, сканеры и радары: кто видит первым, тот стреляет первым.$t$, 80),
  ('ecm', 'systems', $t$Радиоэлектронная борьба$t$, $t$Подавление чужих систем и защита своих.$t$, 90),
  ('active', 'systems', $t$Активная защита$t$, $t$Сбивает и ослепляет то, что летит в корабль.$t$, 100),
  ('control', 'systems', $t$Управление$t$, $t$Боевые информационные системы и искусственный интеллект.$t$, 110),
  ('special', 'systems', $t$Спецсистемы$t$, $t$Сверхсветовые двигатели и другие редкие установки.$t$, 120),
  ('engines', 'systems', $t$Двигатели$t$, $t$Маршевые двигатели: ставятся у кормы.$t$, 130),
  ('shields', 'systems', $t$Щиты и маскировка$t$, $t$Энергетические щиты и генераторы маскировки.$t$, 140),
  ('hull', 'systems', $t$Корпусные системы$t$, $t$Мостик, жилые отсеки, трюмы и ангары.$t$, 150),
  ('tanks', 'systems', $t$Топливные баки$t$, $t$Запас топлива на переходы между системами.$t$, 160)
on conflict (id) do update set section = excluded.section, title = excluded.title, descr = excluded.descr, sort = excluded.sort;

insert into public.v1_modules(id, kind, name, size, params, descr, sort, tech, grp, code, nick, base_name, in_shipyard) values
  ('w_bo40s', 'weapon', $t$БО-40С «Оса»$t$, 'S', $t${"w": 1, "h": 1, "type": "kinetic", "dmg": 1100, "energy": 220, "rng": 4, "acc": 74, "pen": 0.1, "mass": 5, "cost": 5000}$t$::jsonb, $t$Два коротких ствола и быстрая перезарядка. Жалит часто, но неглубоко.$t$, 1000, null, 'light', $t$БО-40С$t$, $t$Оса$t$, $t$40-мм сдвоенное баллистическое орудие$t$, false),
  ('w_bo60', 'weapon', $t$БО-60 «Шмель»$t$, 'S', $t${"w": 1, "h": 1, "type": "kinetic", "dmg": 760, "energy": 150, "rng": 5, "acc": 80, "pen": 0.14, "mass": 3.5, "cost": 3500}$t$::jsonb, $t$Надёжная пушка для патрульных корветов. Ремонтируется в любом доке.$t$, 1010, null, 'light', $t$БО-60$t$, $t$Шмель$t$, $t$60-мм одиночное баллистическое орудие$t$, false),
  ('w_lio1', 'weapon', $t$ЛИО-1 «Искра»$t$, 'S', $t${"w": 1, "h": 1, "type": "energy", "dmg": 650, "energy": 650, "rng": 6, "acc": 92, "pen": 0.05, "mass": 2.5, "cost": 5500}$t$::jsonb, $t$Короткие импульсы почти без промаха. Против толстой брони бесполезна, против дронов — идеальна.$t$, 1020, $t$wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ$t$, 'light', $t$ЛИО-1$t$, $t$Искра$t$, $t$лёгкое одиночное лазерное импульсное орудие$t$, false),
  ('w_emo1', 'weapon', $t$ЭМО-1 «Разряд»$t$, 'S', $t${"w": 1, "h": 1, "type": "energy", "dmg": 520, "energy": 700, "rng": 5, "acc": 85, "pen": 0.05, "mass": 3, "cost": 6000, "shield_k": 1.6}$t$::jsonb, $t$Разряд бьёт по щитам в полтора раза сильнее, чем по корпусу.$t$, 1030, $t$wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ$t$, 'light', $t$ЭМО-1$t$, $t$Разряд$t$, $t$лёгкое одиночное электромагнитное орудие$t$, false),
  ('w_rum100', 'weapon', $t$РУМ-100 «Копьё»$t$, 'M', $t${"w": 2, "h": 1, "type": "kinetic", "dmg": 3100, "energy": 1900, "rng": 9, "acc": 80, "pen": 0.3, "mass": 12, "cost": 14000}$t$::jsonb, $t$Болванка на гиперзвуке пробивает броню насквозь. Требует мощного реактора.$t$, 1040, $t$comp.ship.reactor$t$, 'medium', $t$РУМ-100$t$, $t$Копьё$t$, $t$100-мм рельсовый ускоритель масс$t$, false),
  ('w_bo120d', 'weapon', $t$БО-120Д «Молот»$t$, 'M', $t${"w": 2, "h": 1, "type": "kinetic", "dmg": 4600, "energy": 950, "rng": 5, "acc": 73, "pen": 0.1, "mass": 17, "cost": 12000}$t$::jsonb, $t$Рабочая лошадка эсминцев: два ствола, тяжёлый снаряд, никакой экзотики.$t$, 1050, null, 'medium', $t$БО-120Д$t$, $t$Молот$t$, $t$120-мм двойное баллистическое орудие$t$, false),
  ('w_tl2s', 'weapon', $t$ТЛ-2С «Близнецы»$t$, 'M', $t${"w": 2, "h": 1, "type": "energy", "dmg": 3700, "energy": 3800, "rng": 8, "acc": 93, "pen": 0.05, "mass": 13, "cost": 16000}$t$::jsonb, $t$Спаренные турболазеры бьют залпом по одной точке.$t$, 1060, $t$wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ$t$, 'medium', $t$ТЛ-2С$t$, $t$Близнецы$t$, $t$сдвоенное турболазерное орудие$t$, false),
  ('w_emo2', 'weapon', $t$ЭМО-2 «Гроза»$t$, 'M', $t${"w": 2, "h": 1, "type": "energy", "dmg": 2400, "energy": 3000, "rng": 7, "acc": 86, "pen": 0.05, "mass": 11, "cost": 15000, "shield_k": 1.6}$t$::jsonb, $t$Тяжёлый разрядник, который снимает щиты с крейсера за пару залпов.$t$, 1070, $t$wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ$t$, 'medium', $t$ЭМО-2$t$, $t$Гроза$t$, $t$одиночное электромагнитное орудие$t$, false),
  ('w_bo220', 'weapon', $t$БО-220 «Таран»$t$, 'L', $t${"w": 2, "h": 2, "type": "kinetic", "dmg": 10500, "energy": 1900, "rng": 6, "acc": 72, "pen": 0.15, "mass": 34, "cost": 30000}$t$::jsonb, $t$Башня крейсерского калибра. Медленно поворачивается, но если попала — дыра.$t$, 1080, null, 'heavy', $t$БО-220$t$, $t$Таран$t$, $t$220-мм тяжёлое баллистическое орудие$t$, false),
  ('w_rum250', 'weapon', $t$РУМ-250 «Пика»$t$, 'L', $t${"w": 2, "h": 2, "type": "kinetic", "dmg": 11000, "energy": 6800, "rng": 11, "acc": 82, "pen": 0.4, "mass": 40, "cost": 42000}$t$::jsonb, $t$Самое бронебойное орудие крейсеров. Реактор должен быть под стать.$t$, 1090, $t$comp.ship.reactor$t$, 'heavy', $t$РУМ-250$t$, $t$Пика$t$, $t$тяжёлый рельсовый ускоритель масс$t$, false),
  ('w_po3', 'weapon', $t$ПО-3 «Горн»$t$, 'L', $t${"w": 2, "h": 2, "type": "energy", "dmg": 14400, "energy": 17000, "rng": 4, "acc": 70, "pen": 0.35, "mass": 33, "cost": 50000}$t$::jsonb, $t$Сгусток плазмы прожигает броню вблизи. На дальней дистанции рассеивается.$t$, 1100, $t$rg.school.mgd$t$, 'heavy', $t$ПО-3$t$, $t$Горн$t$, $t$тяжёлое плазменное орудие$t$, false),
  ('w_tl4', 'weapon', $t$ТЛ-4 «Созвездие»$t$, 'L', $t${"w": 2, "h": 2, "type": "energy", "dmg": 27500, "energy": 29000, "rng": 8, "acc": 88, "pen": 0.05, "mass": 72, "cost": 85000}$t$::jsonb, $t$Четыре турболазера в одной башне. Прожорлив, но плотность огня беспримерная.$t$, 1110, $t$wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ$t$, 'heavy', $t$ТЛ-4$t$, $t$Созвездие$t$, $t$счетверённое турболазерное орудие$t$, false),
  ('w_gbo450', 'weapon', $t$ГБО-450 «Цитадель»$t$, 'XL', $t${"w": 3, "h": 2, "type": "kinetic", "dmg": 26000, "energy": 4400, "rng": 8, "acc": 74, "pen": 0.18, "mass": 90, "cost": 90000}$t$::jsonb, $t$Классика линкоров: трёхорудийная башня, снаряд весом с корвет.$t$, 1120, $t$cls.ship.battleship$t$, 'main', $t$ГБО-450$t$, $t$Цитадель$t$, $t$450-мм главное баллистическое орудие$t$, false),
  ('w_oru1', 'weapon', $t$ОРУ-1 «Меридиан»$t$, 'XL', $t${"w": 3, "h": 2, "type": "kinetic", "dmg": 34000, "energy": 21000, "rng": 14, "acc": 84, "pen": 0.45, "mass": 110, "cost": 140000}$t$::jsonb, $t$Ускоритель вдоль всего корпуса. Чтобы прицелиться, разворачивают весь корабль.$t$, 1130, $t$cls.ship.battleship$t$, 'main', $t$ОРУ-1$t$, $t$Меридиан$t$, $t$осевой рельсовый ускоритель главного калибра$t$, false),
  ('w_sl1', 'weapon', $t$СЛ-1 «Солнцеворот»$t$, 'XL', $t${"w": 3, "h": 2, "type": "energy", "dmg": 40000, "energy": 42000, "rng": 12, "acc": 95, "pen": 0.1, "mass": 95, "cost": 180000}$t$::jsonb, $t$Луч, который видно из соседней системы. Требует реактора дредноута.$t$, 1140, $t$cls.ship.dreadnought$t$, 'main', $t$СЛ-1$t$, $t$Солнцеворот$t$, $t$спинальный лазер главного калибра$t$, false),
  ('w_pu6l', 'weapon', $t$ПУ-6Л «Рой»$t$, 'S', $t${"w": 1, "h": 1, "type": "missile", "dmg": 900, "energy": 60, "rng": 20, "acc": 62, "pen": 0.1, "mass": 5, "cost": 6000}$t$::jsonb, $t$Шесть малых ракет залпом: перегружают точечную оборону цели.$t$, 1150, $t$wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ$t$, 'missile', $t$ПУ-6Л$t$, $t$Рой$t$, $t$лёгкая шестиствольная пусковая установка$t$, false),
  ('w_pu4t', 'weapon', $t$ПУ-4Т «Буря»$t$, 'M', $t${"w": 2, "h": 1, "type": "missile", "dmg": 8500, "energy": 500, "rng": 24, "acc": 62, "pen": 0.15, "mass": 28, "cost": 24000}$t$::jsonb, $t$Четыре тяжёлые ракеты с кумулятивной боевой частью.$t$, 1160, $t$wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ$t$, 'missile', $t$ПУ-4Т$t$, $t$Буря$t$, $t$тяжелая четырехствольная пусковая установка$t$, false),
  ('w_shbr1', 'weapon', $t$ШБР-1 «Комета»$t$, 'L', $t${"w": 2, "h": 2, "type": "missile", "dmg": 24000, "energy": 900, "rng": 32, "acc": 58, "pen": 0.2, "mass": 45, "cost": 60000}$t$::jsonb, $t$Одна ракета на залп, но её хватает на крейсер. Стартует из вертикальной шахты.$t$, 1170, $t$wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ$t$, 'missile', $t$ШБР-1$t$, $t$Комета$t$, $t$шахта баллистической ракеты$t$, false),
  ('w_ta2', 'weapon', $t$ТА-2 «Нарвал»$t$, 'M', $t${"w": 2, "h": 1, "type": "missile", "dmg": 12000, "energy": 400, "rng": 14, "acc": 55, "pen": 0.3, "mass": 26, "cost": 30000}$t$::jsonb, $t$Медленная тяжёлая торпеда. Сбить её трудно, увернуться от неё ещё труднее.$t$, 1180, $t$wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ$t$, 'missile', $t$ТА-2$t$, $t$Нарвал$t$, $t$торпедный аппарат$t$, false),
  ('w_lp2', 'weapon', $t$ЛП-2 «Светлячок»$t$, 'S', $t${"w": 1, "h": 1, "type": "energy", "dmg": 300, "energy": 400, "rng": 3, "acc": 95, "pen": 0, "mass": 2, "cost": 4000, "pd": 0.15}$t$::jsonb, $t$Сбивает ракеты и дроны на подлёте: каждый перехват — минус одна пробоина.$t$, 1190, $t$wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ$t$, 'flak', $t$ЛП-2$t$, $t$Светлячок$t$, $t$сдвоенный лазерный пулемёт$t$, false),
  ('w_pvo8', 'weapon', $t$ПВО-8 «Ёж»$t$, 'M', $t${"w": 2, "h": 1, "type": "kinetic", "dmg": 900, "energy": 300, "rng": 4, "acc": 70, "pen": 0, "mass": 10, "cost": 9000, "pd": 0.25}$t$::jsonb, $t$Стена шрапнели вокруг корабля. Против крупных целей почти бесполезен.$t$, 1200, null, 'flak', $t$ПВО-8$t$, $t$Ёж$t$, $t$восьмиствольное ПВО орудие$t$, false),
  ('w_rp1', 'weapon', $t$РП-1 «Стриж»$t$, 'S', $t${"w": 1, "h": 1, "type": "missile", "dmg": 200, "energy": 50, "rng": 10, "acc": 80, "pen": 0, "mass": 3, "cost": 5000, "pd": 0.2}$t$::jsonb, $t$Перехватывает ракеты и торпеды далеко от борта.$t$, 1210, $t$wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ$t$, 'flak', $t$РП-1$t$, $t$Стриж$t$, $t$Ракета-перехватчик$t$, false),
  ('w_rrd1', 'weapon', $t$РРД-1 «Пчела»$t$, 'M', $t${"w": 2, "h": 1, "type": "repair", "heal": 1250, "energy": 600, "rng": 8, "acc": 100, "pen": 0, "mass": 7, "cost": 16000}$t$::jsonb, $t$Дроны латают пробоины своим кораблям прямо в бою.$t$, 1220, $t$wpn.ship.АВИАГРУППЫ И ДРОНЫ$t$, 'support', $t$РРД-1$t$, $t$Пчела$t$, $t$ремонтный рой дронов$t$, false),
  ('w_bl1', 'weapon', $t$БЛ-1 «Якорь»$t$, 'M', $t${"w": 2, "h": 1, "type": "energy", "dmg": 0, "energy": 2500, "rng": 6, "acc": 90, "pen": 0, "mass": 12, "cost": 20000, "slow": 0.3}$t$::jsonb, $t$Захватывает цель и снижает её скорость на треть. Не даёт уйти с поля боя.$t$, 1230, $t$comp.ship.reactor$t$, 'support', $t$БЛ-1$t$, $t$Якорь$t$, $t$буксирный луч$t$, false),
  ('s_sos1', 'comm', $t$СОС-1 «Эфир»$t$, 'S', $t${"w": 1, "h": 1, "comm": 2, "energy": 150, "mass": 2, "cost": 2000}$t$::jsonb, $t$Дальняя связь с флотом и столицей.$t$, 1240, null, 'radar', $t$СОС-1$t$, $t$Эфир$t$, $t$Система общей связи$t$, false),
  ('s_ls1', 'comm', $t$ЛС-1 «Шёпот»$t$, 'S', $t${"w": 1, "h": 1, "comm": 1, "energy": 60, "mass": 1, "cost": 800}$t$::jsonb, $t$Связь внутри эскадры на коротких дистанциях.$t$, 1250, null, 'radar', $t$ЛС-1$t$, $t$Шёпот$t$, $t$Локальная связь$t$, false),
  ('s_ms250', 'sensor', $t$МС-250 «Око»$t$, 'S', $t${"w": 1, "h": 1, "radar": 4, "km": 250, "energy": 500, "mass": 3, "cost": 3500}$t$::jsonb, $t$Универсальный сканер: цели, обломки, аномалии.$t$, 1260, null, 'radar', $t$МС-250$t$, $t$Око$t$, $t$Многоцелевой сканер (+250 км)$t$, false),
  ('s_sdo500', 'sensor', $t$СДО-500 «Дозор»$t$, 'M', $t${"w": 2, "h": 1, "radar": 10, "km": 500, "energy": 1400, "mass": 8, "cost": 9000}$t$::jsonb, $t$Видит флоты в соседних системах.$t$, 1270, $t$comp.ship.radar$t$, 'radar', $t$СДО-500$t$, $t$Дозор$t$, $t$Сканер дальнего обнаружения (+500 км)$t$, false),
  ('s_gr250', 'sensor', $t$ГР-250 «Отвес»$t$, 'S', $t${"w": 1, "h": 1, "radar": 5, "km": 250, "energy": 900, "mass": 4, "cost": 8000, "anti_stealth": 0.5}$t$::jsonb, $t$Чувствует массу, поэтому замечает даже замаскированные корабли.$t$, 1280, $t$rg.school.kvg$t$, 'radar', $t$ГР-250$t$, $t$Отвес$t$, $t$Гравитационный радар (+250 км)$t$, false),
  ('s_ts250', 'sensor', $t$ТС-250 «Жар»$t$, 'S', $t${"w": 1, "h": 1, "radar": 4, "km": 250, "energy": 300, "mass": 2, "cost": 3000}$t$::jsonb, $t$Ищет корабли по тепловому следу реакторов.$t$, 1290, null, 'radar', $t$ТС-250$t$, $t$Жар$t$, $t$Тепловой сканер (+250 км)$t$, false),
  ('s_seb57', 'ecm', $t$СЭБ-57 «Купол»$t$, 'M', $t${"w": 2, "h": 1, "jam": 10, "protect": 5, "energy": 2200, "mass": 9, "cost": 18000}$t$::jsonb, $t$Полный комплекс радиоэлектронной борьбы на одной платформе.$t$, 1300, null, 'ecm', $t$СЭБ-57$t$, $t$Купол$t$, $t$Купол СЭБ-57 (+10 под./+5 защ.)$t$, false),
  ('s_ap2', 'ecm', $t$АП-2 «Шум»$t$, 'S', $t${"w": 1, "h": 1, "jam": 2, "energy": 300, "mass": 2, "cost": 2500}$t$::jsonb, $t$Засоряет эфир вокруг корабля.$t$, 1310, null, 'ecm', $t$АП-2$t$, $t$Шум$t$, $t$Активные помехи (+2 под.)$t$, false),
  ('s_up5', 'ecm', $t$УП-5 «Глушь»$t$, 'S', $t${"w": 1, "h": 1, "jam": 5, "energy": 900, "mass": 4, "cost": 7000}$t$::jsonb, $t$Глушит наведение вражеских орудий.$t$, 1320, null, 'ecm', $t$УП-5$t$, $t$Глушь$t$, $t$Усилитель подавления (+5 под.)$t$, false),
  ('s_np5', 'ecm', $t$НП-5 «Ясность»$t$, 'S', $t${"w": 1, "h": 1, "protect": 5, "energy": 700, "mass": 3, "cost": 6500}$t$::jsonb, $t$Отфильтровывает чужие помехи.$t$, 1330, null, 'ecm', $t$НП-5$t$, $t$Ясность$t$, $t$Нейтрализатор помех (+5 защ.)$t$, false),
  ('s_oes1', 'active', $t$ОЭС-1 «Зрачок»$t$, 'S', $t${"w": 1, "h": 1, "pd": 0.08, "acc_bonus": 3, "energy": 400, "mass": 2, "cost": 4000}$t$::jsonb, $t$Оптика сопровождает цели и наводит точечную оборону.$t$, 1340, null, 'active', $t$ОЭС-1$t$, $t$Зрачок$t$, $t$Оптико-электронные станции$t$, false),
  ('s_ktp1', 'active', $t$КТП-1 «Иней»$t$, 'S', $t${"w": 1, "h": 1, "pd": 0.1, "stealth": 0.1, "energy": 500, "mass": 3, "cost": 5000}$t$::jsonb, $t$Ложные тепловые цели уводят ракеты в сторону.$t$, 1350, null, 'active', $t$КТП-1$t$, $t$Иней$t$, $t$Комплект теплового подавления$t$, false),
  ('s_dp6', 'active', $t$ДП-6 «Стая»$t$, 'M', $t${"w": 2, "h": 1, "pd": 0.2, "energy": 800, "mass": 8, "cost": 12000}$t$::jsonb, $t$Шесть дронов встречают ракеты на дальних подступах.$t$, 1360, $t$wpn.ship.АВИАГРУППЫ И ДРОНЫ$t$, 'active', $t$ДП-6$t$, $t$Стая$t$, $t$Дроны-перехватчики$t$, false),
  ('s_bius', 'control', $t$БИУС «Флагман»$t$, 'M', $t${"w": 2, "h": 1, "command": 10, "acc_bonus": 5, "energy": 1200, "mass": 6, "cost": 20000}$t$::jsonb, $t$Боевая информационная система флагмана: координирует огонь всей эскадры.$t$, 1370, null, 'control', $t$БИУС$t$, $t$Флагман$t$, $t$БИУС Флагман$t$, false),
  ('s_asuo', 'control', $t$АСУО «Терминус»$t$, 'S', $t${"w": 1, "h": 1, "acc_bonus": 4, "energy": 600, "mass": 3, "cost": 9000}$t$::jsonb, $t$Автоматизированная система управления огнём.$t$, 1380, null, 'control', $t$АСУО$t$, $t$Терминус$t$, $t$АСУО Терминус$t$, false),
  ('s_sii', 'control', $t$СИИ-1 «Логос»$t$, 'S', $t${"w": 1, "h": 1, "crew_save": 0.2, "acc_bonus": 3, "energy": 900, "mass": 2, "cost": 25000}$t$::jsonb, $t$Искусственный интеллект берёт на себя рутину: экипаж нужен меньше.$t$, 1390, $t$comp.ship.radar$t$, 'control', $t$СИИ-1$t$, $t$Логос$t$, $t$Системный ИИ$t$, false),
  ('s_photon', 'ftl', $t$СД «Фотон»$t$, 'L', $t${"w": 2, "h": 2, "jump": 2, "energy": 6000, "mass": 30, "cost": 60000}$t$::jsonb, $t$Сверхсветовой прыжок через две системы без гиперпутей.$t$, 1400, $t$comp.ship.engine$t$, 'special', $t$СД$t$, $t$Фотон$t$, $t$Сверхдвигатель Фотон$t$, false),
  ('s_sloboda', 'ftl', $t$ВД «Слобода»$t$, 'XL', $t${"w": 3, "h": 2, "jump": 4, "energy": 15000, "mass": 60, "cost": 150000}$t$::jsonb, $t$Варп-пузырь переносит корабль через полсектора.$t$, 1410, $t$rg.school.kvg$t$, 'special', $t$ВД$t$, $t$Слобода$t$, $t$Варп-двигатель Слобода$t$, false),
  ('cloak_m', 'cloak', $t$ГМ-1 «Мираж»$t$, 'M', $t${"w": 2, "h": 1, "stealth": 0.35, "energy": 3500, "mass": 8, "cost": 30000}$t$::jsonb, $t$Делает корабль невидимым для обычных радаров, пока не откроет огонь.$t$, 900, $t$comp.ship.shield$t$, 'shields', $t$ГМ-1$t$, $t$Мираж$t$, $t$Генератор маскировки$t$, true)
on conflict (id) do update set kind = excluded.kind, name = excluded.name, size = excluded.size, params = excluded.params,
  descr = excluded.descr, sort = excluded.sort, tech = excluded.tech, grp = excluded.grp, code = excluded.code, nick = excluded.nick,
  base_name = excluded.base_name, in_shipyard = excluded.in_shipyard;

update public.v1_modules set grp = 'hull', code = $t$КМ-1$t$, nick = $t$Рубка$t$, base_name = $t$Командный мостик$t$, name = $t$КМ-1 «Рубка»$t$, descr = $t$Сердце корабля: без мостика корабль не выйдет из дока.$t$ where id = 'bridge';

update public.v1_modules set grp = 'hull', code = $t$ЖО-20$t$, nick = $t$Кубрик$t$, base_name = $t$Жилой отсек$t$, name = $t$ЖО-20 «Кубрик»$t$, descr = $t$Койки на двадцать человек.$t$ where id = 'crew_s';

update public.v1_modules set grp = 'hull', code = $t$ЖП-60$t$, nick = $t$Казарма$t$, base_name = $t$Жилая палуба$t$, name = $t$ЖП-60 «Казарма»$t$, descr = $t$Палуба на шестьдесят человек с камбузом и лазаретом.$t$ where id = 'crew_m';

update public.v1_modules set grp = 'hull', code = $t$ГТ-200$t$, nick = $t$Обоз$t$, base_name = $t$Грузовой трюм$t$, name = $t$ГТ-200 «Обоз»$t$, descr = $t$Груз, припасы или десант.$t$ where id = 'cargo_m';

update public.v1_modules set grp = 'hull', code = $t$ГТ-600$t$, nick = $t$Караван$t$, base_name = $t$Большой трюм$t$, name = $t$ГТ-600 «Караван»$t$, descr = $t$Трюм для снабжения флота и колоний.$t$ where id = 'cargo_l';

update public.v1_modules set grp = 'hull', code = $t$АН-4$t$, nick = $t$Гнездо$t$, base_name = $t$Ангар$t$, name = $t$АН-4 «Гнездо»$t$, descr = $t$Четыре звена авиации и стартовая палуба.$t$ where id = 'hangar';

update public.v1_modules set grp = 'engines', code = $t$МД-1$t$, nick = $t$Ход$t$, base_name = $t$Маршевый двигатель S$t$, name = $t$МД-1 «Ход»$t$, descr = $t$Лёгкий двигатель для корветов.$t$ where id = 'eng_s';

update public.v1_modules set grp = 'engines', code = $t$МД-2$t$, nick = $t$Тяга$t$, base_name = $t$Маршевый двигатель M$t$, name = $t$МД-2 «Тяга»$t$, descr = $t$Основной двигатель эсминцев и фрегатов.$t$ where id = 'eng_m';

update public.v1_modules set grp = 'engines', code = $t$МД-3$t$, nick = $t$Атлант$t$, base_name = $t$Маршевый двигатель L$t$, name = $t$МД-3 «Атлант»$t$, descr = $t$Тяжёлый двигатель крейсеров и линкоров.$t$ where id = 'eng_l';

update public.v1_modules set grp = 'shields', code = $t$ГЩ-1$t$, nick = $t$Завеса$t$, base_name = $t$Генератор щита S$t$, name = $t$ГЩ-1 «Завеса»$t$, descr = $t$Лёгкий щит: держит осколки и лёгкие лазеры.$t$ where id = 'shield_s';

update public.v1_modules set grp = 'shields', code = $t$ГЩ-2$t$, nick = $t$Эгида$t$, base_name = $t$Генератор щита M$t$, name = $t$ГЩ-2 «Эгида»$t$, descr = $t$Основной щит эсминцев.$t$ where id = 'shield_m';

update public.v1_modules set grp = 'shields', code = $t$ГЩ-3$t$, nick = $t$Твердь$t$, base_name = $t$Генератор щита L$t$, name = $t$ГЩ-3 «Твердь»$t$, descr = $t$Щит крейсеров и линкоров.$t$ where id = 'shield_l';

update public.v1_modules set grp = 'radar', code = $t$РК-1$t$, nick = $t$Взор$t$, base_name = $t$Радарный комплекс$t$, name = $t$РК-1 «Взор»$t$, descr = $t$Корабельный радар общего назначения.$t$ where id = 'sensor';

update public.v1_modules set grp = 'radar', code = $t$ДР-1$t$, nick = $t$Маяк$t$, base_name = $t$Дальний радар$t$, name = $t$ДР-1 «Маяк»$t$, descr = $t$Обзор на соседние системы.$t$ where id = 'sensor_l';

update public.v1_modules set grp = 'tanks', code = $t$ТБ-10$t$, nick = $t$Фляга$t$, base_name = $t$Малый топливный бак$t$, name = $t$ТБ-10 «Фляга»$t$, descr = $t$Для корветов и катеров.$t$ where id = 'tank_s';

update public.v1_modules set grp = 'tanks', code = $t$ТБ-25$t$, nick = $t$Бочка$t$, base_name = $t$Стандартный топливный бак$t$, name = $t$ТБ-25 «Бочка»$t$, descr = $t$Эталонный бак: по нему считается дальность марки топлива.$t$ where id = 'tank_m';

update public.v1_modules set grp = 'tanks', code = $t$ТБ-60$t$, nick = $t$Цистерна$t$, base_name = $t$Большой топливный бак$t$, name = $t$ТБ-60 «Цистерна»$t$, descr = $t$Дальние рейды и тяжёлые корабли.$t$ where id = 'tank_l';

update public.v1_modules set grp = 'tanks', code = $t$ТББ-18$t$, nick = $t$Сейф$t$, base_name = $t$Бронированный бак$t$, name = $t$ТББ-18 «Сейф»$t$, descr = $t$Меньше топлива, зато пробить его вдвое труднее.$t$ where id = 'tank_arm';

-- ════════ Верфь видит только то, что к ней уже подключено ════════
do $$
declare d text;
begin
  d := pg_get_functiondef('public.v1_ship_calc(text, jsonb, text)'::regprocedure);
  if position('md.in_shipyard' in d) = 0 then
    execute replace(d, 'md.id = iid and not md.frozen', 'md.id = iid and not md.frozen and md.in_shipyard');
  end if;
  d := pg_get_functiondef('public.v1_shipyard_state()'::regprocedure);
  if position('m.in_shipyard' in d) = 0 then
    execute replace(d, 'from v1_modules m left join v1_tech t on t.id = m.tech where not m.frozen', 'from v1_modules m left join v1_tech t on t.id = m.tech where not m.frozen and m.in_shipyard');
  end if;
end $$;

-- ════════ Каталог для вики ════════
-- Открыт всем, даже без входа. Для игрока с державой — пометка «доступно».
create or replace function public.v1_arsenal() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_fid text; v_done jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null then
    v_fid := v1_my_faction();
    if v_fid is not null then
      select coalesce(research, '[]'::jsonb) into v_done from faction_economy where faction_id = v_fid;
    end if;
  end if;
  return jsonb_build_object(
    'mine', v_fid is not null,
    'groups', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'section', g.section, 'title', g.title, 'descr', g.descr,
        'cover', g.cover, 'count', (select count(*) from v1_modules m where m.grp = g.id and not m.frozen)) order by g.sort), '[]'::jsonb)
      from v1_arsenal_groups g),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'grp', m.grp, 'kind', m.kind, 'size', m.size,
        'code', m.code, 'nick', m.nick, 'base_name', m.base_name, 'name', m.name, 'descr', m.descr, 'params', m.params,
        'tech', m.tech, 'tech_name', t.name, 'in_shipyard', m.in_shipyard,
        'open', m.tech is null or coalesce(v_done, '[]'::jsonb) ? m.tech) order by m.sort), '[]'::jsonb)
      from v1_modules m left join v1_tech t on t.id = m.tech where m.grp is not null and not m.frozen));
end $$;
grant execute on function public.v1_arsenal() to anon, authenticated;

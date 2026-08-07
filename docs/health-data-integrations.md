# Health data integrations — capability matrix

Personal triathlon / recovery tracking. Official docs only. No scraping, no unofficial Garmin APIs.

Statuses: **supported** | **unsupported** | **unconfirmed**

Sources consulted (public):

- [Garmin Health API](https://developer.garmin.com/gc-developer-program/health-api/)
- [Garmin Activity API](https://developer.garmin.com/gc-developer-program/activity-api/)
- [Garmin Training API](https://developer.garmin.com/gc-developer-program/training-api/)
- [Garmin Program FAQ](https://developer.garmin.com/gc-developer-program/program-faq)
- [Garmin OAuth2 PKCE](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE_1.pdf)
- [WHOOP API](https://developer.whoop.com/api/)
- [WHOOP Webhooks](https://developer.whoop.com/docs/developing/webhooks/)
- [MyFitnessPal API](https://www.myfitnesspal.com/apps/api)
- [MFP Data Export FAQs](https://support.myfitnesspal.com/hc/en-us/articles/360032273352-Data-Export-FAQs)

Field-level Garmin JSON schemas sit behind the Developer Portal after approval. Category-level claims below come from public pages; sub-fields not named publicly are **unconfirmed**.

---

## Access / transport

| Data / capability | Source | Endpoint / resource | Availability | Granularity | Update frequency | History | Sync mechanism | Webhook or polling | Unit | Known limits | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Program access | Garmin Connect Developer Program | developerportal.garmin.com | Enterprise / business review | n/a | n/a | n/a | Application + approval | n/a | n/a | Business use only; ~2 business days | supported (gated) |
| OAuth | Garmin | OAuth 2.0 PKCE | After approval | n/a | n/a | n/a | Authorization code + PKCE | n/a | n/a | Permissions e.g. HEALTH_EXPORT, ACTIVITY_EXPORT | supported |
| Health push/pull | Garmin Health API | Portal OpenAPI (post-approval) | After approval | Summaries / epochs | On device sync | Backfill tool exists; day limit unconfirmed | Ping/Pull or Push | Both | JSON | Exact REST paths unconfirmed publicly | supported |
| Activity details + files | Garmin Activity API | Portal + FIT/GPX/TCX | After approval | Per activity | On device sync | Backfill tool exists | Ping/Pull or Push | Both | JSON + FIT | Full details via FIT | supported |
| Training publish | Garmin Training API | Publish workouts/plans to Connect calendar | After approval | Workout / plan | On publish | n/a | Push to Garmin | n/a | n/a | Publish only on public docs | supported |
| Training calendar READ | Garmin Training API | — | Not documented as receive API | — | — | — | — | — | — | Overview: receive=Health/Activity; push=Training | **unsupported** (public docs) |
| Connect IQ cloud sync | Connect IQ | Separate SDK | Free SDK | Device apps | n/a | n/a | Not a Connect cloud substitute | n/a | n/a | Wrong product for Health/Activity sync | **unsupported** |
| OAuth + scopes | WHOOP | developer.whoop.com OAuth | Self-serve with WHOOP membership | n/a | n/a | Paginated start/end | OAuth2 + offline refresh | Webhooks + poll reconcile | n/a | API currently free | supported |
| MFP self-serve API | MyFitnessPal | Private partner API | Approved developers only | — | — | — | — | — | — | Contact API@myfitnesspal.com | **unsupported** (self-serve) |
| MFP CSV export | MyFitnessPal Premium | Email zip (nutrition, progress, exercise) | Premium / Premium+ | Daily / meal rows | Manual export | Export window per product UI | Manual upload | n/a | kcal, g, mg | Free tier: no CSV | supported |

---

## Garmin Health

| Data | Source | Resource | Availability | Granularity | Update | History | Sync | Hook/poll | Unit | Limits | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Sleep (category) | Garmin Health | Sleep summary | After approval | Session / day | Device sync | Backfill unconfirmed limit | Ping/Pull or Push | Both | varies | Schema behind portal | supported |
| Sleep total duration | Garmin Health | Sleep | After approval | Session | Device sync | unconfirmed | Same | Both | minutes / seconds | Field not listed publicly | **unconfirmed** |
| Bed / wake times | Garmin Health | Sleep | After approval | Session | Device sync | unconfirmed | Same | Both | timestamp | Field not listed publicly | **unconfirmed** |
| Sleep stages | Garmin Health | Sleep | After approval | Stage blocks | Device sync | unconfirmed | Same | Both | minutes | Field not listed publicly | **unconfirmed** |
| Sleep score | Garmin Health | Sleep | After approval | Session | Device sync | unconfirmed | Same | Both | score | Field not listed publicly | **unconfirmed** |
| Heart rate (all-day) | Garmin Health | Heart Rate | After approval | Samples / summaries | Device sync | unconfirmed | Same | Both | bpm | Named publicly | supported |
| Resting heart rate | Garmin Health | — | After approval | Daily | Device sync | unconfirmed | Same | Both | bpm | Not named on public Health page | **unconfirmed** |
| HRV (generic) | Garmin Health | — | After approval | Daily / night | Device sync | unconfirmed | Same | Both | ms | Not named; Enhanced Beat-To-Beat needs commercial license | **unconfirmed** |
| Enhanced Beat-To-Beat | Garmin Health | Beat-to-beat | Commercial license | Interval | Device sync | unconfirmed | Same | Both | ms | License fee | supported (licensed) |
| Stress | Garmin Health | Stress / detailed stress | After approval | Epoch / day | Device sync | unconfirmed | Same | Both | score | Named | supported |
| Body Battery | Garmin Health | Body Battery | After approval | Day / samples | Device sync | unconfirmed | Same | Both | score | Named | supported |
| Respiration | Garmin Health | Respiration | After approval | Samples / day | Device sync | unconfirmed | Same | Both | brpm | Named | supported |
| SpO2 | Garmin Health | Pulse Ox | After approval | Samples / day | Device sync | unconfirmed | Same | Both | % | Named | supported |
| Steps | Garmin Health | Steps | After approval | Day / epoch | Device sync | unconfirmed | Same | Both | count | Named | supported |
| Calories | Garmin Health | Calories | After approval | Day | Device sync | unconfirmed | Same | Both | kcal | Named | supported |
| Intensity minutes | Garmin Health | Intensity Minutes | After approval | Day | Device sync | unconfirmed | Same | Both | minutes | Named | supported |
| Weight / body composition | Garmin Health | Body Composition | After approval | Measurement | Device sync | unconfirmed | Same | Both | kg / % | Named | supported |
| Blood pressure | Garmin Health | Blood Pressure | After approval | Measurement | Device sync | unconfirmed | Same | Both | mmHg | Named | supported |

---

## Garmin Activities

| Data | Source | Resource | Availability | Granularity | Update | History | Sync | Hook/poll | Unit | Limits | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Sport / activity type | Garmin Activity | Activity summary | After approval | Per activity | Device sync | Backfill tool | Ping/Pull or Push | Both | enum | 30+ types named (run/bike/swim/strength…) | supported |
| Start / end | Garmin Activity | Activity | After approval | Per activity | Device sync | unconfirmed | Same | Both | timestamp | Likely in summary/FIT; JSON field unconfirmed | **unconfirmed** |
| Duration | Garmin Activity | Activity | After approval | Per activity | Device sync | unconfirmed | Same | Both | seconds | unconfirmed as JSON field | **unconfirmed** |
| Distance | Garmin Activity | Activity | After approval | Per activity | Device sync | unconfirmed | Same | Both | m | unconfirmed as JSON field | **unconfirmed** |
| Calories | Garmin Activity | Activity | After approval | Per activity | Device sync | unconfirmed | Same | Both | kcal | unconfirmed as JSON field | **unconfirmed** |
| HR avg / max | Garmin Activity | Activity / FIT | After approval | Per activity | Device sync | unconfirmed | Same | Both | bpm | Often in FIT | **unconfirmed** (JSON) / likely in FIT |
| Power avg / max / NP | Garmin Activity | Activity / FIT | After approval | Per activity | Device sync | unconfirmed | Same | Both | W | Device-dependent; FIT | **unconfirmed** |
| Cadence | Garmin Activity | Activity / FIT | After approval | Per activity | Device sync | unconfirmed | Same | Both | rpm / spm | FIT | **unconfirmed** |
| Pace / speed | Garmin Activity | Activity / FIT | After approval | Per activity | Device sync | unconfirmed | Same | Both | m/s | FIT | **unconfirmed** |
| Elevation | Garmin Activity | Activity / FIT | After approval | Per activity | Device sync | unconfirmed | Same | Both | m | FIT | **unconfirmed** |
| Training effect | Garmin Activity | Activity / FIT | After approval | Per activity | Device sync | unconfirmed | Same | Both | score | Not named publicly | **unconfirmed** |
| Training load | Garmin Activity | Activity / FIT | After approval | Per activity | Device sync | unconfirmed | Same | Both | load | Not named publicly | **unconfirmed** |
| Temperature | Garmin Activity | Activity / FIT | After approval | Per activity | Device sync | unconfirmed | Same | Both | °C | Not named publicly | **unconfirmed** |
| Laps | Garmin Activity | Activity / FIT | After approval | Lap | Device sync | unconfirmed | Same | Both | varies | FIT | **unconfirmed** |
| Time series samples | Garmin Activity | FIT | After approval | Sample | Device sync | unconfirmed | Same | Both | varies | Via FIT SDK | **unconfirmed** as first-class JSON |
| Original FIT file | Garmin Activity | FIT download | After approval | File | Device sync | unconfirmed | Same | Both | file | Explicitly supported | supported |
| FTP | Garmin | — | — | — | — | — | — | — | W | Not on public Health/Activity pages | **unconfirmed** |
| VO2 max | Garmin | — | — | — | — | — | — | — | ml/kg/min | Not on public pages | **unconfirmed** |

---

## WHOOP

| Data | Source | Resource | Availability | Granularity | Update | History | Sync | Hook/poll | Unit | Limits | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Sleep start/end, nap | WHOOP | `/v2/activity/sleep` | Self-serve | Session | Near real-time + reconcile | start/end pagination | OAuth pull + webhooks | Both | timestamp | Missed webhooks possible | supported |
| Sleep stages | WHOOP | Sleep `stage_summary` | Self-serve | Session | Same | Same | Same | Both | ms / counts | light/SWS/REM/awake/in-bed | supported |
| Sleep performance / consistency / efficiency | WHOOP | Sleep score | Self-serve | Session | Same | Same | Same | Both | % | Named fields | supported |
| Respiratory rate (sleep) | WHOOP | Sleep score | Self-serve | Session | Same | Same | Same | Both | rpm | Named | supported |
| Recovery score | WHOOP | `/v2/recovery` | Self-serve | Cycle | Same | Same | Same | Both | 0–100 | Webhook recovery.* | supported |
| HRV (RMSSD) | WHOOP | Recovery score | Self-serve | Cycle | Same | Same | Same | Both | ms | `hrv_rmssd_milli` | supported |
| Resting HR | WHOOP | Recovery score | Self-serve | Cycle | Same | Same | Same | Both | bpm | Named | supported |
| SpO2 / skin temp | WHOOP | Recovery score | Self-serve | Cycle | Same | Same | Same | Both | % / °C | Named | supported |
| Strain (cycle) | WHOOP | `/v2/cycle` | Self-serve | Physio day | Same | Same | Poll (no cycle webhook) | Poll | strain | No cycle webhook | supported |
| Workouts | WHOOP | `/v2/activity/workout` | Self-serve | Workout | Same | Same | Webhook + poll | Both | sport, HR, distance, zones, energy | Continuous HR via REST unsupported | supported |
| Body measurements | WHOOP | `read:body_measurement` | Self-serve | Profile | On change | Same | Poll | Poll | height/weight/max HR | Scope required | supported |
| Continuous HR stream | WHOOP | — | — | — | — | — | BLE only | — | bpm | Not via REST API | **unsupported** |

---

## Nutrition

| Data | Source | Resource | Availability | Granularity | Update | History | Sync | Hook/poll | Unit | Limits | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Calories | Manual / MFP CSV | nutrition_daily / events | App | Day / meal | Manual | User-controlled | CSV import or form | n/a | kcal | MFP API self-serve unavailable | supported (manual/CSV) |
| Carbs / protein / fat / fiber / sodium | Manual / MFP CSV | Same | App | Day / meal | Manual | User-controlled | Same | n/a | g / mg | Same | supported (manual/CSV) |
| Meal time | Manual / MFP CSV | nutrition_events | App | Event | Manual | User-controlled | Same | n/a | timestamp | Same | supported |
| Carbs pre / during / post session | Manual / derived | nutrition_events linked to activity | App | Event | Manual | User-controlled | App logic | n/a | g | Requires timestamps | supported (app) |
| Water | Manual | nutrition_events / daily | App | Event / day | Manual | User-controlled | Form | n/a | ml | — | supported |
| Caffeine | Manual | nutrition_events | App | Event | Manual | User-controlled | Form | n/a | mg | — | supported |

---

## Manual measures

| Data | Source | Resource | Availability | Granularity | Update | History | Sync | Hook/poll | Unit | Limits | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Morning weight | Manual | body_measurements | App | Daily | Manual | Unlimited | Form | n/a | kg | Prefer morning fasted | supported |
| Hunger / fatigue / motivation / pain / illness / free text | Manual | subjective_checkins | App | Daily | Manual | Unlimited | Form | n/a | 1–10 / text | Subjective | supported |
| Session RPE | Manual | activities / checkins | App | Per session | Manual | Unlimited | Form | n/a | 1–10 | — | supported |
| Sweat rate test | Manual | hydration_tests | App | Per test | Manual | Unlimited | Form + formula | n/a | L/h | Sodium concentration not inferred from volume | supported |
| Sweat sodium concentration | Manual / lab | hydration_tests | App | Per test | Manual | Unlimited | Form | n/a | mg/L | Must be measured or parameterized | supported (manual only) |

---

## Product rules

1. Never invent Garmin REST paths; wire real client only after portal OpenAPI review.
2. Training calendar READ stays **unsupported** until Garmin confirms privately → then update this matrix.
3. Observations are not medical diagnoses.
4. OAuth tokens encrypted at rest (`HEALTH_TOKEN_ENCRYPTION_KEY`); never logged.

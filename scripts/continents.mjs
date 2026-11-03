/**
 * Country name → continent lookup (Natural Earth 50m names).
 * Continents used by the game: NA, SA, EU, AS, AF, OC.
 * Anything missing is inferred by build-world.mjs from mapped neighbours.
 */
const NA = [
  'Canada', 'United States of America', 'Mexico', 'Greenland', 'Guatemala', 'Belize',
  'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama', 'Cuba', 'Jamaica',
  'Haiti', 'Dominican Rep.', 'Puerto Rico', 'Trinidad and Tobago', 'Bahamas', 'Barbados',
  'St. Lucia', 'Dominica', 'St. Vin. and Gren.', 'Antigua and Barb.', 'St. Kitts and Nevis',
  'Grenada', 'Cayman Is.', 'Turks and Caicos Is.', 'British Virgin Is.', 'U.S. Virgin Is.',
  'Anguilla', 'Montserrat', 'Bermuda', 'St. Pierre and Miquelon',
];
const SA = [
  'Colombia', 'Venezuela', 'Guyana', 'Suriname', 'Ecuador', 'Peru', 'Brazil', 'Bolivia',
  'Paraguay', 'Uruguay', 'Argentina', 'Chile', 'Falkland Is.', 'S. Geo. and the Is.',
];
const EU = [
  'Iceland', 'Norway', 'Sweden', 'Finland', 'Åland', 'Estonia', 'Latvia', 'Lithuania',
  'Denmark', 'Faeroe Is.', 'United Kingdom', 'Ireland', 'Netherlands', 'Belgium',
  'Luxembourg', 'France', 'Jersey', 'Guernsey', 'Isle of Man', 'Germany', 'Poland',
  'Belarus', 'Ukraine', 'Switzerland', 'Austria', 'Czechia', 'Slovakia', 'Hungary',
  'Slovenia', 'Croatia', 'Bosnia and Herz.', 'Serbia', 'Montenegro', 'Kosovo', 'Macedonia',
  'Albania', 'Greece', 'Bulgaria', 'Romania', 'Moldova', 'Italy', 'Vatican', 'San Marino',
  'Malta', 'Spain', 'Portugal', 'Andorra', 'Monaco', 'Cyprus',
];
const AS = [
  'Russia', 'Kazakhstan', 'Mongolia', 'China', 'North Korea', 'South Korea', 'Taiwan',
  'Japan', 'Philippines', 'Vietnam', 'Laos', 'Cambodia', 'Thailand', 'Malaysia', 'Brunei',
  'Indonesia', 'Myanmar', 'Bangladesh', 'India', 'Pakistan', 'Nepal', 'Bhutan', 'Sri Lanka',
  'Maldives', 'Afghanistan', 'Iran', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan',
  'Georgia', 'Armenia', 'Azerbaijan', 'Turkey', 'Syria', 'Iraq', 'Israel', 'Palestine',
  'Lebanon', 'Jordan', 'Saudi Arabia', 'Yemen', 'Oman', 'United Arab Emirates', 'Qatar',
  'Bahrain', 'Kuwait', 'Timor-Leste', 'Siachen Glacier', 'Hong Kong', 'Macao',
];
const AF = [
  'Algeria', 'Morocco', 'W. Sahara', 'Mauritania', 'Mali', 'Niger', 'Chad', 'Sudan',
  'S. Sudan', 'Libya', 'Egypt', 'Tunisia', 'Ethiopia', 'Eritrea', 'Somalia', 'Somaliland',
  'Djibouti', 'Senegal', 'Gambia', 'Guinea', 'Guinea-Bissau', 'Sierra Leone', 'Liberia',
  "Côte d'Ivoire", 'Ghana', 'Togo', 'Benin', 'Nigeria', 'Cameroon', 'Central African Rep.',
  'Eq. Guinea', 'Gabon', 'Congo', 'Dem. Rep. Congo', 'Uganda', 'Kenya', 'Tanzania',
  'Rwanda', 'Burundi', 'Angola', 'Zambia', 'Malawi', 'Mozambique', 'Zimbabwe', 'Botswana',
  'Namibia', 'South Africa', 'Lesotho', 'eSwatini', 'Madagascar', 'Mauritius', 'Comoros',
  'Seychelles', 'Cabo Verde',
];
const OC = [
  'Australia', 'New Zealand', 'Papua New Guinea', 'Solomon Is.', 'Vanuatu', 'New Caledonia',
  'Fiji', 'Samoa', 'Tonga', 'Nauru', 'Kiribati', 'Marshall Is.', 'Micronesia', 'Palau',
  'Guam', 'N. Mariana Is.', 'American Samoa', 'Cook Is.', 'Niue', 'Wallis and Futuna Is.',
  'Fr. Polynesia', 'Pitcairn Is.', 'Norfolk Island', 'Heard I. and McDonald Is.',
  'Indian Ocean Ter.', 'Ashmore and Cartier Is.', 'Br. Indian Ocean Ter.',
];

const map = {};
for (const [cont, names] of [['NA', NA], ['SA', SA], ['EU', EU], ['AS', AS], ['AF', AF], ['OC', OC]]) {
  for (const n of names) map[n] = cont;
}
export default map;

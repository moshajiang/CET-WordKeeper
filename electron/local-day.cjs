// 先按设备本地日历构造午夜，再转 UTC；用日历加一天兼容夏令时的 23/25 小时日。
function localDayRange(date = new Date()) {
  const year = date.getFullYear(), month = date.getMonth(), day = date.getDate();
  return { start:new Date(year,month,day).toISOString(),end:new Date(year,month,day+1).toISOString() };
}
module.exports = { localDayRange };

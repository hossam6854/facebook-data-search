// src/pages/SmartLocalSearch.jsx
import React, { useEffect, useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";

export default function SmartLocalSearch() {
  const [data, setData] = useState([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, withData: 0 });
  const [selectedItem, setSelectedItem] = useState(null);

  // 🔹 إضافة حالة التصفح
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);

  // 🔹 حالة جديدة لتحديد إذا كان البحث قد بدأ
  const [searchStarted, setSearchStarted] = useState(false);

  // 🔹 حالات جديدة للتحميل المتقدم
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const dataChunksRef = useRef([]);
  const CHUNK_SIZE = 5000; // تحميل 5,000 سجل في كل دفعة (تقليل حجم الـ chunk)
  const MAX_CHUNKS_IN_MEMORY = 50; // الحد الأقصى للـ chunks في الذاكرة

  // 🔹 حالات جديدة للميزات المتقدمة
  const [searchHistory, setSearchHistory] = useState([]);
  const [filters, setFilters] = useState({
    fileType: "all", // all, text, excel
    hasPhone: false,
    hasEmail: false,
  });
  const [sortBy, setSortBy] = useState("relevance"); // relevance, name, source
  const [displayedResults, setDisplayedResults] = useState(30);
  const searchInputRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // 🔹 تنظيف النص العربي المتقدم
  const normalizeArabic = (str) => {
    if (!str || str === "" || str === " ") return "";

    let s = String(str)
      .replace(/[إأآٱ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/\s+/g, " ")
      .trim();

    return s;
  };

  // 🔹 تنظيف وتحضير البيانات من الصف
  const cleanRowData = (row) => {
    if (!row) return "";

    const allFields = Object.values(row).filter(
      (val) => val && val !== "" && val !== " " && String(val).length > 0
    );

    if (allFields.length === 0) return "";

    const cleanedText = allFields
      .map((field) => field)
      .filter((text) => text.length > 0)
      .join(" ");

    return cleanedText;
  };

 

  // 🔹 تحليل ملفات TXT وتحويلها إلى JSON
  const parseTxtFile = (content, fileName) => {
    try {
      const lines = content.split("\n").filter((line) => line.trim() !== "");

      // محاولة اكتشاف إذا كان الملف يحتوي على رأس (header)
      const firstLine = lines[0];
      const isCSVLike =
        firstLine.includes(",") ||
        firstLine.includes(";") ||
        firstLine.includes("\t");

      let jsonData = [];

      if (isCSVLike) {
        // إذا كان ملف CSV-like
        const separator = firstLine.includes(",")
          ? ","
          : firstLine.includes(";")
          ? ";"
          : "\t";

        const headers = firstLine.split(separator).map((h) => h.trim());

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(separator).map((v) => {
            // تنظيف كل قيمة وإزالة الاقتباسات الزائدة
            let cleaned = v.trim().replace(/^"|"$/g, "");
            return cleaned;
          });

          const row = {};
          let hasData = false;

          headers.forEach((header, index) => {
            // الشرط المعدل: إزالة القيمة "0" فقط بدون أي أحرف أخرى
            if (
              values[index] !== undefined &&
              values[index] !== null &&
              values[index] !== "" &&
              values[index] !== " " &&
              values[index] !== '""' &&
              values[index] !== "''" &&
              values[index] !== "0" && // فقط القيمة "0" بدون أي أحرف إضافية
              !values[index].includes("1/1/0001") && // استبعاد التواريخ الفارغة فقط
              String(values[index]).trim().length > 0
            ) {
              // معالجة أرقام الهواتف إذا كان الحقل هو phone
              if (
                header.toLowerCase().includes("phone") ||
                header.toLowerCase().includes("tel")
              ) {
                row[header] = processPhoneNumber(values[index]);
              } else {
                row[header] = values[index];
              }
              hasData = true;
            }
          });

          // فقط نضيف الصف إذا كان يحتوي على بيانات حقيقية
          if (hasData && Object.keys(row).length > 0) {
            jsonData.push(row);
          }
        }
      } else {
        // إذا كان ملف نصي عادي، نتعامل مع كل سطر ككائن منفصل
        jsonData = lines
          .map((line, index) => {
            const cleanedLine = line.trim();
            if (
              !cleanedLine ||
              cleanedLine === "" ||
              /^\s+$/.test(cleanedLine)
            ) {
              return null;
            }

            // البحث عن أرقام هواتف في النص ومعالجتها
            let processedLine = cleanedLine;
            const phoneRegex = /(\+?2)?\s*(\d{10,})/g;
            let match;
            while ((match = phoneRegex.exec(cleanedLine)) !== null) {
              const fullMatch = match[0];
              const processedPhone = processPhoneNumber(fullMatch);
              processedLine = processedLine.replace(fullMatch, processedPhone);
            }

            return {
              id: `${fileName}_${index}`,
              content: processedLine,
              text: processedLine,
            };
          })
          .filter(Boolean)
          .filter(
            (item) =>
              item.content &&
              item.content !== "" &&
              item.content !== " " &&
              item.content !== "0" && // إضافة نفس الشرط للملفات النصية
              item.content.length > 0
          );
      }

      console.log(
        `✅ تم تحليل ${fileName}: ${jsonData.length} سجل بعد التصفية`
      );
      return jsonData;
    } catch (error) {
      console.error(`خطأ في تحليل ملف ${fileName}:`, error);
      return [];
    }
  };

  // 🔹 تحميل وتحليل الملفات بطريقة Chunked (على دفعات)
  useEffect(() => {
    const files = [
      "/data/Egypt_1.txt",
      "/data/Egypt_2.txt",
      "/data/Egypt_3.txt",
      "/data/Egypt_4.txt",
    ];

    async function loadFilesInChunks() {
      let totalRecords = 0;
      let recordsWithData = 0;
      dataChunksRef.current = [];

      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setLoadingMessage(`جاري تحميل ${file}...`);

          try {
            const response = await fetch(file);
            if (!response.ok) continue;

            const isTxtFile = file.toLowerCase().endsWith(".txt");
            const isExcelFile = file.toLowerCase().endsWith(".xlsx");

            if (!isTxtFile && !isExcelFile) continue;

            let fileData = [];

            if (isExcelFile) {
              const buffer = await response.arrayBuffer();
              const workbook = XLSX.read(buffer, { type: "array" });
              const sheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[sheetName];
              const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

              fileData = json
                .map((row) => {
                  const cleanedRow = {};
                  Object.keys(row).forEach((key) => {
                    if (row[key] && row[key] !== "" && row[key] !== " ") {
                      if (
                        key.toLowerCase().includes("phone") ||
                        key.toLowerCase().includes("tel")
                      ) {
                        cleanedRow[key] = processPhoneNumber(row[key]);
                      } else {
                        cleanedRow[key] = row[key];
                      }
                    }
                  });

                  const cleanedText = cleanRowData(cleanedRow);
                  return {
                    text: cleanedText,
                    source: `Egypt_${i + 1}.xlsx`,
                    original: cleanedRow,
                    hasContent: cleanedText.length > 3,
                    id:
                      cleanedRow.id || Math.random().toString(36).substr(2, 9),
                    fileType: "excel",
                  };
                })
                .filter(
                  (item) => item.text && Object.keys(item.original).length > 0
                );
            } else if (isTxtFile) {
              const textContent = await response.text();
              const json = parseTxtFile(textContent, `Egypt_${i + 1}`);

              fileData = json
                .map((row) => {
                  const rawText =
                    row.text || row.content || JSON.stringify(row);
                  const cleanedText = normalizeArabic(rawText);

                  const filteredOriginal = {};
                  Object.keys(row).forEach((key) => {
                    const value = row[key];
                    if (
                      value &&
                      value !== "" &&
                      value !== " " &&
                      value !== '""' &&
                      value !== "''" &&
                      !String(value).includes("1/1/0001") &&
                      String(value).trim().length > 0
                    ) {
                      filteredOriginal[key] = value;
                    }
                  });

                  return {
                    text: cleanedText,
                    source: `Egypt_${i + 1}.txt`,
                    original: filteredOriginal,
                    hasContent:
                      cleanedText.length > 3 &&
                      Object.keys(filteredOriginal).length > 0,
                    id: row.id || Math.random().toString(36).substr(2, 9),
                    fileType: "text",
                  };
                })
                .filter(
                  (item) =>
                    item.text &&
                    item.hasContent &&
                    Object.keys(item.original).length > 0
                );
            }

            // 🔹 تقسيم البيانات إلى chunks مع تحديد الحد الأقصى
            for (let j = 0; j < fileData.length; j += CHUNK_SIZE) {
              const chunk = fileData.slice(j, j + CHUNK_SIZE);
              dataChunksRef.current.push(chunk);
              
              // تحرير الذاكرة إذا تجاوزنا الحد الأقصى
              if (dataChunksRef.current.length > MAX_CHUNKS_IN_MEMORY) {
                // نحتفظ فقط بآخر MAX_CHUNKS_IN_MEMORY chunks
                dataChunksRef.current = dataChunksRef.current.slice(-MAX_CHUNKS_IN_MEMORY);
              }
            }

            totalRecords += fileData.length;
            recordsWithData += fileData.filter((item) => item.hasContent).length;

            // تحديث التقدم
            const progress = ((i + 1) / files.length) * 100;
            setLoadingProgress(progress);

            console.log(`📁 تم تحميل ${file}: ${fileData.length} سجل`);
          } catch (fileErr) {
            console.error(`خطأ في معالجة ${file}:`, fileErr);
          }
        }

        // حفظ فقط عينة صغيرة للعرض الأولي
        const sampleData = dataChunksRef.current
          .slice(0, 3)
          .flat()
          .slice(0, 500); // تقليل العينة الأولية
        setData(sampleData);
        setResults([]);
        setStats({
          total: totalRecords,
          withData: recordsWithData,
        });

        setLoadingMessage("✅ اكتمل التحميل!");
        console.log(
          `🎉 تم تحميل ${totalRecords} سجل في ${dataChunksRef.current.length} chunk`
        );
      } catch (err) {
        console.error("خطأ في تحميل الملفات:", err);
        setLoadingMessage("❌ حدث خطأ في التحميل");
      } finally {
        setTimeout(() => setLoading(false), 500);
      }
    }

    loadFilesInChunks();
  }, []);


  // 🔹 البحث التلقائي - التصحيح الرئيسي هنا
  // 🔹 البحث الدقيق - بدلاً من استخدام Fuse.js
  const performExactSearch = (searchQuery, searchData) => {
    if (!searchQuery.trim()) return [];

    const normalizedQuery = normalizeArabic(searchQuery).trim();

    // إذا كان البحث عبارة عن رقم هاتف (يحتوي على أرقام فقط)
    const isPhoneSearch = /^\d+$/.test(normalizedQuery.replace(/[\s\-+]/g, ""));

    return searchData.filter((item) => {
      if (!item.original) return false;

      // البحث في جميع الحقول
      const fieldsToSearch = [
        "text",
        ...Object.values(item.original).map((val) => String(val)),
      ];

      for (const field of fieldsToSearch) {
        if (!field) continue;

        const fieldString = String(field);

        // إذا كان البحث عن رقم هاتف، نستخدم منطق دقيق
        if (isPhoneSearch) {
          const cleanField = fieldString.replace(/[\s\-+]/g, "");
          const cleanQuery = normalizedQuery.replace(/[\s\-+]/g, "");

          // البحث الدقيق للرقم بالكامل
          if (cleanField === cleanQuery) {
            return true;
          }

          // البحث عن الصيغ المختلفة لنفس الرقم
          const phoneVariations = generatePhoneVariations(cleanQuery);
          if (phoneVariations.some((variation) => cleanField === variation)) {
            return true;
          }

          // البحث عن الرقم كجزء من النص (لكن فقط إذا كان الرقم طويلاً)
          if (cleanQuery.length >= 8 && cleanField.includes(cleanQuery)) {
            return true;
          }
        } else {
          // البحث النصي العادي - بحث دقيق
          if (
            fieldString.toLowerCase().includes(normalizedQuery.toLowerCase())
          ) {
            return true;
          }

          // بحث مطابقة تامة للنص
          if (fieldString.toLowerCase() === normalizedQuery.toLowerCase()) {
            return true;
          }
        }
      }

      return false;
    });
  };

  // 🔹 إنشاء الصيغ المختلفة لأرقام الهواتف
  const generatePhoneVariations = (phone) => {
    const variations = new Set();

    if (!phone) return Array.from(variations);

    // الصيغة الأساسية
    variations.add(phone);

    // إضافة +2 في البداية إذا لم تكن موجودة
    if (!phone.startsWith("2") && !phone.startsWith("+2")) {
      variations.add(`2${phone}`);
      variations.add(`+2${phone}`);
    }

    // إزالة +2 أو 2 من البداية إذا كانت موجودة
    if (phone.startsWith("+2")) {
      variations.add(phone.substring(2));
    }
    if (phone.startsWith("2")) {
      variations.add(phone.substring(1));
    }

    // الصيغة مع مسافات (مثال: 010 1234 5678)
    if (phone.length === 10) {
      variations.add(
        `${phone.substring(0, 3)} ${phone.substring(3, 6)} ${phone.substring(
          6
        )}`
      );
      variations.add(
        `${phone.substring(0, 3)}-${phone.substring(3, 6)}-${phone.substring(
          6
        )}`
      );
    }

    // الصيغة الدولية الكاملة
    if (phone.length === 10 && !phone.startsWith("+")) {
      variations.add(`+20${phone}`);
    }

    return Array.from(variations);
  };



  // 🔹 البحث المحسّن مع Debouncing
  useEffect(() => {
    if (query.trim() === "") {
      setResults([]);
      setSearchStarted(false);
      setCurrentPage(1);
      setIsSearching(false);
      setDisplayedResults(30);
      return;
    }

    setSearchStarted(true);
    setIsSearching(true);

    // Debouncing - الانتظار 300ms قبل البحث
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      performSearch();
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query]);

  // 🔹 دالة البحث الرئيسية - محسّنة لتقليل استهلاك الذاكرة
  const performSearch = async () => {
    const allResults = [];
    const normalizedQuery = normalizeArabic(query).trim();
    const startTime = performance.now();
    const MAX_RESULTS = 10000; // الحد الأقصى للنتائج لتجنب استهلاك الذاكرة

    for (let i = 0; i < dataChunksRef.current.length; i++) {
      // إيقاف البحث إذا وصلنا للحد الأقصى من النتائج
      if (allResults.length >= MAX_RESULTS) {
        console.log(`⚠️ تم الوصول للحد الأقصى من النتائج (${MAX_RESULTS})`);
        break;
      }

      const chunk = dataChunksRef.current[i];
      const chunkResults = performExactSearch(normalizedQuery, chunk);
      allResults.push(...chunkResults.slice(0, MAX_RESULTS - allResults.length));

      // تحديث النتائج تدريجياً كل 5 chunks
      if (i % 5 === 0 || i === dataChunksRef.current.length - 1) {
        setResults([...allResults]);
      }

      // إعطاء فرصة للواجهة للتحديث وتحرير الذاكرة
      if (i % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const endTime = performance.now();
    const searchTime = ((endTime - startTime) / 1000).toFixed(2);

    // تطبيق الفلاتر
    let filteredResults = applyFilters(allResults);
    
    // تطبيق الترتيب
    filteredResults = applySorting(filteredResults);

    setResults(filteredResults);
    setIsSearching(false);
    setCurrentPage(1);
    setDisplayedResults(50);

    // إضافة للسجل
    addToSearchHistory(query, filteredResults.length, searchTime);

    console.log(`✅ البحث اكتمل في ${searchTime} ثانية - ${filteredResults.length} نتيجة`);
  };

  // 🔹 تطبيق الفلاتر
  const applyFilters = (results) => {
    let filtered = [...results];

    if (filters.fileType !== "all") {
      filtered = filtered.filter((item) => item.fileType === filters.fileType);
    }

    if (filters.hasPhone) {
      filtered = filtered.filter((item) =>
        Object.keys(item.original).some(
          (key) =>
            key.toLowerCase().includes("phone") ||
            key.toLowerCase().includes("tel")
        )
      );
    }

    if (filters.hasEmail) {
      filtered = filtered.filter((item) =>
        Object.keys(item.original).some((key) =>
          key.toLowerCase().includes("email")
        )
      );
    }

    return filtered;
  };

  // 🔹 تطبيق الترتيب
  const applySorting = (results) => {
    const sorted = [...results];

    switch (sortBy) {
      case "name":
        return sorted.sort((a, b) => {
          const nameA =
            a.original.name ||
            a.original.first_name ||
            a.original.content ||
            "";
          const nameB =
            b.original.name ||
            b.original.first_name ||
            b.original.content ||
            "";
          return nameA.localeCompare(nameB, "ar");
        });
      case "source":
        return sorted.sort((a, b) => a.source.localeCompare(b.source));
      default:
        return sorted; // relevance - الترتيب الافتراضي
    }
  };

  // 🔹 إضافة للسجل
  const addToSearchHistory = (searchQuery, resultsCount, time) => {
    const historyItem = {
      query: searchQuery,
      count: resultsCount,
      time: time,
      timestamp: new Date().toLocaleTimeString("ar-EG"),
    };

    setSearchHistory((prev) => [historyItem, ...prev.slice(0, 9)]); // آخر 10 عمليات بحث
  };

  // 🔹 تحسين معالجة أرقام الهواتف في تحميل البيانات
  const processPhoneNumber = (phone) => {
    if (!phone) return phone;

    let phoneStr = String(phone).trim();

    // إزالة جميع المسافات والشرطات
    phoneStr = phoneStr.replace(/[\s\-+]/g, "");

    // إزالة الرقم 2 من البداية إذا كان موجوداً (لتحويله للصيغة المحلية)
    if (phoneStr.startsWith("2")) {
      phoneStr = phoneStr.substring(1);
    }

    return phoneStr;
  };

  // 🔹 Infinite Scroll - عرض النتائج تدريجياً
  const currentItems = results.slice(0, displayedResults);
  const hasMore = displayedResults < results.length;

  // 🔹 تحميل المزيد من النتائج
  const loadMore = () => {
    setDisplayedResults((prev) => Math.min(prev + 30, results.length));
  };

  // 🔹 Keyboard Shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Ctrl+K أو Cmd+K للتركيز على البحث
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }

      // ESC للخروج من البحث
      if (e.key === "Escape") {
        setQuery("");
        searchInputRef.current?.blur();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, []);

  // 🔹 تمييز النص في النتائج
  const highlightText = (text, highlight) => {
    if (!highlight.trim() || !text) return text;

    const normalizedHighlight = normalizeArabic(highlight);
    const normalizedText = normalizeArabic(String(text));
    const index = normalizedText.toLowerCase().indexOf(normalizedHighlight.toLowerCase());

    if (index === -1) return text;

    const beforeMatch = String(text).substring(0, index);
    const match = String(text).substring(index, index + normalizedHighlight.length);
    const afterMatch = String(text).substring(index + normalizedHighlight.length);

    return (
      <>
        {beforeMatch}
        <mark className="bg-yellow-300 px-1 rounded">{match}</mark>
        {afterMatch}
      </>
    );
  };

  // 🔹 تصدير النتائج
  const exportResults = () => {
    const dataToExport = results.map((item) => item.original);
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Results");
    XLSX.writeFile(workbook, `search_results_${Date.now()}.xlsx`);
  };

  // 🔹 الحصول على الأيقونة المناسبة للحقل
  const getFieldIcon = (key) => {
    const icons = {
      first_name: "👤",
      last_name: "👤",
      name: "👤",
      nickname: "🏷️",
      email: "📧",
      phone: "📱",
      birthday: "🎂",
      gender: "⚧️",
      work_at: "💼",
      specialty: "🎯",
      adress1: "📍",
      adress2: "🏙️",
      studied_at: "🎓",
      major: "📚",
      bio: "📝",
      link: "🔗",
      id: "🆔",
      content: "📄",
      text: "📝",
    };
    return icons[key] || "📄";
  };

  // 🔹 ترجمة أسماء الحقول
  const translateField = (key) => {
    const translations = {
      first_name: "الاسم الأول",
      last_name: "الاسم الأخير",
      name: "الاسم الكامل",
      nickname: "اللقب",
      email: "البريد الإلكتروني",
      phone: "الهاتف",
      birthday: "تاريخ الميلاد",
      gender: "الجنس",
      work_at: "مكان العمل",
      specialty: "التخصص",
      adress2: "العنوان",
      adress1: "المدينة",
      studied_at: "مكان الدراسة",
      major: "التخصص الدراسي",
      bio: "الوصف",
      link: "الرابط",
      id: "المعرف",
      content: "المحتوى",
      text: "النص",
    };
    return translations[key] || key;
  };

  // 🔹 عرض البطاقة الرئيسية للبيانات - 3 حقول بجانب بعض
  const renderDataCard = (item) => {
    if (!item.original) return null;

    const importantFields = [
      "first_name",
      "last_name",
      "phone",
      "adress1",
      "adress2",
      "content",
      "text",
      "nickname",
    ];

    // الحصول على الحقول المهمة التي تحتوي على بيانات فقط
    const mainFields = Object.entries(item.original)
      .filter(
        ([key, value]) =>
          importantFields.includes(key) &&
          value &&
          value !== "" &&
          value !== " " &&
          String(value).length > 0
      )
      .slice(0, 6); // نأخذ فقط أول 3 حقول لعرضها بجانب بعض

    // إذا لم توجد حقول مهمة، نعرض أول 3 حقول متاحة تحتوي على بيانات
    const availableFields =
      mainFields.length > 0
        ? mainFields
        : Object.entries(item.original)
            .filter(([key, value]) => value && value !== "" && value !== " ")
            .slice(0, 6);

    if (availableFields.length === 0) return null;

    // الحصول على الاسم المعروض
    const displayName =
      item.original.name ||
      `${item.original.first_name || ""} ${
        item.original.last_name || ""
      }`.trim() ||
      item.original.nickname ||
      item.original.content?.substring(0, 30) ||
      item.original.text?.substring(0, 30) ||
      "غير معروف";

    return (
      <div
        className="bg-gradient-to-br from-white to-amber-50 rounded-2xl shadow-lg border border-amber-200 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 cursor-pointer"
        onClick={() => setSelectedItem(item)}
      >
        <div className="p-6">
          {/* الهيدر */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center space-x-3 space-x-reverse">
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg ${
                  item.fileType === "text"
                    ? "bg-gradient-to-r from-blue-500 to-cyan-500"
                    : "bg-gradient-to-r from-amber-500 to-orange-500"
                }`}
              >
                {item.original.first_name?.[0] || displayName[0] || "📄"}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-lg text-gray-800 truncate">
                  {displayName}
                </h3>
                {item.original.id && (
                  <p className="text-amber-600 text-sm">{item.original.id}</p>
                )}
              </div>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                item.fileType === "text"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {item.source}
            </span>
          </div>

          {/* البيانات الرئيسية - 3 حقول بجانب بعض */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {availableFields.map(([key, value], idx) => (
              <div
                key={idx}
                className="text-center p-2 bg-white rounded-lg border border-amber-100 hover:bg-amber-50 transition-colors"
              >
                <div className="text-amber-600 text-lg mb-1">
                  {getFieldIcon(key)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 font-semibold mb-1">
                    {translateField(key)}
                  </p>
                  <p
                    className="text-xs text-gray-800 truncate"
                    title={String(value)}
                  >
                    {String(value).length > 15
                      ? highlightText(String(value).substring(0, 15) + "...", query)
                      : highlightText(String(value), query)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* الفوتر */}
          <div className="flex items-center justify-between pt-4 border-t border-amber-100">
            <div className="flex items-center space-x-2 space-x-reverse text-xs text-gray-500">
              <span>📊</span>
              <span>
                {
                  Object.values(item.original).filter((v) => v && v !== "")
                    .length
                }{" "}
                حقل
              </span>
              <span
                className={`w-2 h-2 rounded-full ${
                  item.fileType === "text" ? "bg-blue-400" : "bg-amber-400"
                }`}
              ></span>
              <span>{item.fileType === "text" ? "TXT" : "Excel"}</span>
            </div>
            <button className="text-amber-600 hover:text-amber-700 text-sm font-semibold transition-colors cursor-pointer">
              عرض التفاصيل →
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 🔹 المودال لعرض التفاصيل الكاملة
  const renderDetailModal = () => {
    if (!selectedItem) return null;

    // في المودال نعرض جميع الحقول التي تحتوي على بيانات فقط
    const fields = Object.entries(selectedItem.original)
      .filter(
        ([key, value]) =>
          String(value).trim() !== "" && value !== null && value !== undefined
      )
      .sort(([a], [b]) => {
        const order = [
          "name",
          "first_name",
          "last_name",
          "email",
          "phone",
          "content",
          "text",
        ];
        return order.indexOf(a) - order.indexOf(b) || a.localeCompare(b);
      });

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
          {/* الهيدر */}
          <div
            className={`p-6 text-white ${
              selectedItem.fileType === "text"
                ? "bg-gradient-to-r from-blue-500 to-cyan-500"
                : "bg-gradient-to-r from-amber-500 to-orange-500"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4 space-x-reverse">
                <div className="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center text-2xl">
                  {selectedItem.original.first_name?.[0] ||
                    selectedItem.original.name?.[0] ||
                    selectedItem.original.content?.[0] ||
                    "📄"}
                </div>
                <div>
                  <h2 className="text-2xl font-bold">
                    {selectedItem.original.name ||
                      `${selectedItem.original.first_name || ""} ${
                        selectedItem.original.last_name || ""
                      }`.trim() ||
                      selectedItem.original.content?.substring(0, 50) ||
                      "غير معروف"}
                  </h2>
                  {selectedItem.original.id && (
                    <p className="opacity-90">{selectedItem.original.id}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="text-white hover:opacity-70 text-2xl transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>

          {/* المحتوى - جميع الحقول التي تحتوي على بيانات فقط */}
          <div className="p-6 max-h-[60vh] overflow-y-auto">
            {fields.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                لا توجد بيانات متاحة للعرض
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {fields.map(([key, value], idx) => (
                  <div
                    key={idx}
                    className="bg-gray-50 rounded-xl p-4 hover:bg-amber-50 transition-colors"
                  >
                    <div className="flex items-start space-x-3 space-x-reverse">
                      <span
                        className={`text-xl mt-1 ${
                          selectedItem.fileType === "text"
                            ? "text-blue-500"
                            : "text-amber-600"
                        }`}
                      >
                        {getFieldIcon(key)}
                      </span>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-700 mb-1">
                          {translateField(key)}
                        </h3>
                        {key === "link" ? (
                          <a
                            href={
                              value.startsWith("http")
                                ? value
                                : `https://${value}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-amber-600 hover:text-amber-700 font-semibold break-all"
                          >
                            {value}
                          </a>
                        ) : (
                          <p className="text-gray-900 text-sm leading-relaxed break-words">
                            {highlightText(String(value), query)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* الفوتر */}
          <div className="border-t border-gray-200 p-4 bg-gray-50">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>المصدر: {selectedItem.source}</span>
              <div className="flex items-center space-x-2 space-x-reverse">
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    selectedItem.fileType === "text"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {selectedItem.fileType === "text" ? "ملف نصي" : "ملف Excel"}
                </span>
                <span>🆔 {selectedItem.id}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // 🔹 مكون Load More (بدلاً من Pagination)
  const renderLoadMore = () => {
    if (!hasMore) return null;

    return (
      <div className="flex justify-center items-center mt-8">
        <button
          onClick={loadMore}
          className="px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-2xl hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg font-semibold flex items-center space-x-2 space-x-reverse"
        >
          <span>تحميل المزيد</span>
          <span>({results.length - displayedResults} متبقي)</span>
        </button>
      </div>
    );
  };

  // 🔹 واجهة المستخدم
  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-screen text-lg font-semibold text-gray-600"
        dir="rtl"
      >
        <div className="text-center max-w-md mx-auto">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-amber-600 mx-auto mb-4"></div>
          <p className="mb-4">{loadingMessage || "جارِ تحميل البيانات..."}</p>
          
          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-4 mb-2">
            <div
              className="bg-gradient-to-r from-amber-500 to-orange-500 h-4 rounded-full transition-all duration-300"
              style={{ width: `${loadingProgress}%` }}
            ></div>
          </div>
          <p className="text-sm text-gray-500">{Math.round(loadingProgress)}%</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-7xl mx-auto">
        {/* الهيدر الرئيسي */}
        <div className="text-center mb-12 mt-12">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent mb-4">
            الباحث الذكي
          </h1>
          <p className="text-gray-600 text-lg">
            يدعم كلاً من ملفات Excel وملفات النص
          </p>
        </div>
        {/* إحصائيات البيانات */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-amber-50 rounded-xl border border-amber-200">
              <div className="text-2xl font-bold text-amber-700">
                {stats.total}
              </div>
              <div className="text-sm text-gray-600">إجمالي السجلات</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-xl border border-green-200">
              <div className="text-2xl font-bold text-green-700">
                {stats.withData}
              </div>
              <div className="text-sm text-gray-600">
                سجلات تحتوي على بيانات
              </div>
            </div>
            <div className="text-center p-4 bg-blue-50 rounded-xl border border-blue-200">
              <div className="text-2xl font-bold text-blue-700">
                {data.filter((item) => item.fileType === "text").length}
              </div>
              <div className="text-sm text-gray-600">ملفات نصية</div>
            </div>
            <div className="text-center p-4 bg-orange-50 rounded-xl border border-orange-200">
              <div className="text-2xl font-bold text-orange-700">
                {data.filter((item) => item.fileType === "excel").length}
              </div>
              <div className="text-sm text-gray-600">ملفات Excel</div>
            </div>
          </div>
        </div>
        {/* شريط البحث */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-8">
          <div className="flex flex-col lg:flex-row gap-4 items-center">
            <div className="flex-1 relative">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="🔍 ابحث في جميع البيانات... (Ctrl+K للبحث السريع)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full px-6 py-4 border border-amber-300 rounded-2xl shadow-sm focus:ring-2 focus:ring-amber-500 focus:outline-none text-gray-800 text-lg bg-amber-50 transition-all"
                disabled={isSearching}
              />
              <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-xs text-gray-500 bg-amber-100 px-2 py-1 rounded">
                {isSearching ? (
                  <span className="flex items-center">
                    <span className="animate-spin mr-1">⏳</span>
                    جاري البحث...
                  </span>
                ) : (
                  <span>
                    {results.length > 20000
                      ? "20,000+"
                      : results.length.toLocaleString()}{" "}
                    نتيجة
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                setQuery("");
                setResults([]);
                setSearchStarted(false);
              }}
              className="px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-2xl hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg font-semibold"
            >
              مسح البحث
            </button>
          </div>
          {query && /^\d+$/.test(query.replace(/[\s\-+]/g, "")) && (
            <div className="mt-2 text-sm text-green-600 flex items-center">
              <span className="ml-2">✓</span>
              <span>
                بحث دقيق - سيظهر فقط النتائج المطابقة تماماً
              </span>
            </div>
          )}
        </div>
        {/* الفلاتر والترتيب */}
        {searchStarted && results.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* الفلاتر */}
              <div className="flex items-center space-x-4 space-x-reverse flex-wrap gap-2">
                <span className="text-sm font-semibold text-gray-700">🎯 فلتر:</span>
                <select
                  value={filters.fileType}
                  onChange={(e) => setFilters({ ...filters, fileType: e.target.value })}
                  className="px-4 py-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none text-sm"
                >
                  <option value="all">كل الملفات</option>
                  <option value="text">ملفات نصية فقط</option>
                  <option value="excel">Excel فقط</option>
                </select>

                <label className="flex items-center space-x-2 space-x-reverse cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.hasPhone}
                    onChange={(e) => setFilters({ ...filters, hasPhone: e.target.checked })}
                    className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
                  />
                  <span className="text-sm text-gray-700">📱 يحتوي على هاتف</span>
                </label>

                <label className="flex items-center space-x-2 space-x-reverse cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.hasEmail}
                    onChange={(e) => setFilters({ ...filters, hasEmail: e.target.checked })}
                    className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
                  />
                  <span className="text-sm text-gray-700">📧 يحتوي على بريد</span>
                </label>
              </div>

              {/* الترتيب */}
              <div className="flex items-center space-x-4 space-x-reverse">
                <span className="text-sm font-semibold text-gray-700">📊 ترتيب:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-4 py-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none text-sm"
                >
                  <option value="relevance">الأكثر صلة</option>
                  <option value="name">حسب الاسم</option>
                  <option value="source">حسب المصدر</option>
                </select>

                <button
                  onClick={exportResults}
                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all text-sm font-semibold flex items-center space-x-2 space-x-reverse"
                >
                  <span>📥</span>
                  <span>تصدير</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* النتائج */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-800">النتائج</h2>
            <div className="flex items-center space-x-4 space-x-reverse">
              {searchStarted && (
                <span className="bg-amber-100 text-amber-800 px-4 py-2 rounded-full font-semibold animate-pulse">
                  {results.length.toLocaleString()} نتيجة
                </span>
              )}
              {searchStarted && results.length > 0 && (
                <span className="text-gray-600 text-sm">
                  عرض {Math.min(displayedResults, results.length)} من {results.length.toLocaleString()}
                </span>
              )}
            </div>
          </div>

          {!searchStarted ? (
            // 🔹 التغيير: عرض رسالة ترحيبية بدلاً من النتائج
            <div className="text-center py-16 bg-white rounded-2xl shadow-lg">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-xl font-semibold text-gray-700 mb-2">
                ابدأ بالبحث الآن
              </h3>
              <p className="text-gray-500 mb-4">
                اكتب في شريط البحث أعلاه للعثور على النتائج المطلوبة
              </p>
              <div className="text-sm text-gray-400">
                متوفر {stats.total.toLocaleString()} سجل للبحث فيها
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl shadow-lg">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-xl font-semibold text-gray-700 mb-2">
                لا توجد نتائج
              </h3>
              <p className="text-gray-500">جرب استخدام كلمات بحث مختلفة</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {currentItems.map((item, idx) => (
                  <div key={item.id || idx} className="animate-fade-in">
                    {renderDataCard(item)}
                  </div>
                ))}
              </div>

              {/* Load More */}
              {renderLoadMore()}
            </>
          )}
        </div>
      </div>

      {/* المودال */}
      {renderDetailModal()}

      {/* سجل البحث */}
      {searchHistory.length > 0 && (
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-8">
          <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
            <span className="mr-2">🕐</span>
            سجل البحث الأخير
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {searchHistory.slice(0, 6).map((item, idx) => (
              <div
                key={idx}
                onClick={() => setQuery(item.query)}
                className="bg-amber-50 rounded-lg p-3 cursor-pointer hover:bg-amber-100 transition-all border border-amber-200"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-800 truncate flex-1">
                    {item.query}
                  </span>
                  <span className="text-xs text-gray-500">{item.timestamp}</span>
                </div>
                <div className="flex items-center space-x-3 space-x-reverse text-xs text-gray-600">
                  <span>📊 {item.count} نتيجة</span>
                  <span>⏱️ {item.time}s</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* الفوتر */}
      <footer className="mt-16 bg-gradient-to-r from-amber-50 to-orange-50 border-t border-amber-100 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="text-gray-600 text-sm mb-2">
            © {new Date().getFullYear()}{" "}
            <span className="font-semibold text-amber-700">الباحث الذكي</span> —
            جميع الحقوق محفوظة.
          </div>

          <div className="text-xs text-gray-400">
            صُمم بواسطة{" "}
            <a
              href="https://hossam6854.github.io/My-portfolio"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-600 hover:text-amber-700 font-medium transition-colors"
            >
              Hossam Sayed
            </a>
          </div>
        </div>
      </footer>

      {/* إضافة أنيميشن */}
      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out;
        }
      `}</style>
    </div>
  );
}
